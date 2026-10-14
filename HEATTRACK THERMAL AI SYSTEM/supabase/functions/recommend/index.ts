// HeatTrack: AI recommendation for one analytics result.
//
// The dashboard calls this with { analytics_id } for each result it shows that
// has no AI text yet. The function:
//   1. reads the result AS THE SIGNED-IN USER (row-level security: users can
//      only ask about their own results),
//   2. gathers the air readings of that interval, the previous result and the
//      latest recommendations (so the new one is not a repeat),
//   3. asks an AI for a recommendation in a fixed JSON shape, grounded in the
//      same guideline actions the website used before,
//   4. saves it in analytics.ai_recommendation (so each result is sent to an AI
//      only once) and returns it.
//
// AI providers, tried in this order. When one reaches its free limit (per
// minute or per day), fails, or answers badly, the next one is used; a provider
// at its daily limit is skipped for a while instead of being asked again:
//   1. Google Gemini 2.5 Flash       (GEMINI_API_KEY)
//   2. Google Gemini 2.5 Flash-Lite  (GEMINI_API_KEY, its own separate limit)
//   3. Groq, Llama 3.3 70B           (GROQ_API_KEY)
//   4. OpenRouter free model         (OPENROUTER_API_KEY)
// A provider without its key is skipped. If every provider is out, the website
// keeps showing its built-in guideline text.
//
// Secrets (Supabase -> Edge Functions -> Secrets):
//   GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY   (at least one)
//   optional model overrides: GEMINI_MODEL, GEMINI_LITE_MODEL, GROQ_MODEL, OPENROUTER_MODEL
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// The guideline actions the website showed before (script.js "recommendations").
// The AI uses them as the safe reference it must stay within.
const GUIDELINES: Record<string, string[]> = {
    CRITICAL: [
        'Activate emergency cooling now (sprinklers + fans at 100%)',
        'Move high-temperature ducks to a shaded recovery pen within 3 minutes',
        'Start intensive rehydration: cool (not cold) clean water at multiple access points',
        'Apply misting cycles every 2-3 minutes, paired with ventilation so humidity does not trap heat',
        'Escalate to a veterinarian if severe signs persist for more than 10 minutes',
    ],
    HIGH: [
        'Run cooling fans at high speed and open all airflow panels',
        'Replace drinking water now and recheck trough temperature every 20 minutes',
        'Separate crowded groups in the hottest zone to reduce heat load',
        'Inspect at-risk ducks every 10 minutes for panting, wing spread, or lethargy',
        'Pause stressful handling and feeding until ambient temperature improves',
    ],
    MODERATE: [
        'Shift feeding to early morning or late afternoon to avoid peak heat',
        'Confirm all drinkers are clean, flowing, and reachable from every section',
        'Deploy temporary shade and reduce direct sun exposure in open areas',
        'Track temperature and humidity trends every 15 minutes for early escalation',
        'Pre-stage cooling equipment so response is immediate if readings rise',
    ],
    LOW: [
        'Continue routine monitoring and keep automated alerts enabled',
        'Maintain baseline ventilation and verify fan operation once per shift',
        'Log sensor and behavior data for daily heat-risk trend review',
        'Perform preventive checks of water supply and backup cooling systems',
    ],
};

const RECHECK: Record<string, string> = {
    CRITICAL: 'immediately (within 1-3 minutes)',
    HIGH: 'within 10 minutes',
    MODERATE: 'within 15 minutes',
    LOW: 'within 30 minutes',
};

const CATEGORIES = ['Suggested Action', 'Prevention', 'Environmental', 'Temperature'];

// Gemini structured output: the answer always has exactly these fields
const RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        action: { type: 'STRING', description: 'The single most important action right now, as a short imperative headline (max 90 characters).' },
        category: { type: 'STRING', enum: CATEGORIES, description: 'Which kind of action the headline is.' },
        tip: { type: 'STRING', description: 'One sentence (max 140 characters) explaining how to carry out the headline action well.' },
        explanation: { type: 'STRING', description: '2 short sentences: what the readings of THIS result mean and why the actions are recommended. Mention the actual numbers.' },
        suggested_actions: { type: 'ARRAY', items: { type: 'STRING' }, description: '3-5 concrete actions to take now for this result, most urgent first. Each max 20 words.' },
        prevention: { type: 'ARRAY', items: { type: 'STRING' }, description: '3-5 heat stress prevention measures to stop it getting worse or happening again. Each max 20 words.' },
        environmental_insights: { type: 'ARRAY', items: { type: 'STRING' }, description: '2-3 observations about the air temperature, humidity and their trend for this result. Each max 25 words.' },
        temperature_guidance: { type: 'ARRAY', items: { type: 'STRING' }, description: '2-3 points about the ducks\' surface temperatures in this result and when to recheck. Each max 25 words.' },
    },
    required: ['action', 'category', 'tip', 'explanation', 'suggested_actions', 'prevention', 'environmental_insights', 'temperature_guidance'],
    propertyOrdering: ['action', 'category', 'tip', 'explanation', 'suggested_actions', 'prevention', 'environmental_insights', 'temperature_guidance'],
};

// Groq / OpenRouter have no schema option, so the same shape is spelled out in the prompt
const JSON_SHAPE = `Answer with ONLY a JSON object with exactly these keys:
{
  "action": "the single most important action right now, short imperative headline, max 90 characters",
  "category": one of ${CATEGORIES.map((c) => `"${c}"`).join(', ')},
  "tip": "one sentence, max 140 characters, how to carry out the headline action well",
  "explanation": "2 short sentences: what THIS result's readings mean and why; mention the actual numbers",
  "suggested_actions": ["3-5 concrete actions to take now, most urgent first, each max 20 words"],
  "prevention": ["3-5 heat stress prevention measures, each max 20 words"],
  "environmental_insights": ["2-3 observations about air temperature, humidity and trend, each max 25 words"],
  "temperature_guidance": ["2-3 points about the ducks' surface temperatures and when to recheck, each max 25 words"]
}`;

const SYSTEM_PROMPT = `You are HeatTrack's heat-stress advisor for duck farmers.
You receive one monitoring result (a 10- or 30-minute interval) from a duck house: the heat-stress severity, the ducks' estimated surface temperatures from a thermal camera, the number of ducks detected, and the air temperature and humidity from a DHT22 sensor.

Rules:
- The severity level is decided by a trained model. Never change it, downplay it or contradict it; match the urgency of your advice to it.
- Base every point on the numbers given. Mention actual values (surface temperature, air temperature, humidity, duck count, trend) where they matter.
- Stay within the GUIDELINE ACTIONS for the severity: you may make them more specific to these readings, reorder them, or combine them, but do not invent unrelated or risky interventions.
- Never give medication names or doses. For CRITICAL results, include escalating to a veterinarian if signs persist.
- When humidity is high, note that evaporative cooling (misting/sprinklers) works less well and must be paired with strong ventilation.
- Surface temperatures are thermal-camera estimates; advise confirming visually (panting, wing spreading, lethargy) before drastic action.
- Use the recheck time given for the severity.
- Every result must get a UNIQUE recommendation, even when its severity or status is the same as earlier results. Never reuse a headline, tip, explanation or list item from the RECENT RECOMMENDATIONS, word for word or with only small changes. Lead with a different guideline action than the recent headlines when possible, and make each point specific to THIS result's numbers, duck count and trend.
- Plain, practical language a farm worker can follow. No markdown, no emojis.`;

const num = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const fmt = (v: number | null, unit: string) => (v === null ? 'unknown' : `${v.toFixed(1)}${unit}`);

function cleanText(v: unknown, max: number) {
    return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanList(v: unknown, maxItems: number) {
    return (Array.isArray(v) ? v : []).map((s) => cleanText(s, 220)).filter(Boolean).slice(0, maxItems);
}

// Pull the JSON object out of a model's text (some wrap it in ```json fences or a sentence)
function parseJsonText(text: string): Record<string, unknown> {
    try {
        return JSON.parse(text);
    } catch (_) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end <= start) throw new Error('no JSON object in the answer');
        return JSON.parse(text.slice(start, end + 1));
    }
}

// ---------------- AI providers ----------------

type Outcome =
    | { ok: true; parsed: Record<string, unknown> }
    | { ok: false; limited: boolean; daily: boolean; skipMs: number; detail: string };

interface Provider {
    id: string;          // stored with the recommendation, e.g. "gemini-2.5-flash"
    label: string;       // for logs
    generate: (prompt: string) => Promise<Outcome>;
}

const MINUTE_MS = 60 * 1000;
const DAILY_SKIP_MS = 60 * MINUTE_MS;     // a provider at its daily limit is skipped for an hour, then checked again
const BROKEN_SKIP_MS = 6 * 60 * MINUTE_MS; // wrong key / retired model: skipped for 6 hours

// Providers to skip until a time (kept while this function instance stays warm)
const skipUntil: Record<string, number> = {};

const DAILY_PATTERN = /per ?day|perday|daily|RPD|TPD|requests per day|tokens per day/i;

// Turn a failed HTTP answer into "limited for a minute / for the day / broken"
async function failure(res: Response, label: string): Promise<Outcome> {
    const detail = (await res.text().catch(() => '')).slice(0, 600);
    if (res.status === 429) {
        const daily = DAILY_PATTERN.test(detail);
        const retryAfter = Number(res.headers.get('retry-after'));
        const skipMs = daily ? DAILY_SKIP_MS : Math.min(Math.max((retryAfter || 60) * 1000, MINUTE_MS), 10 * MINUTE_MS);
        return { ok: false, limited: true, daily, skipMs, detail };
    }
    // 401/403 = bad or revoked key, 404 = model name no longer exists
    const broken = res.status === 401 || res.status === 403 || res.status === 404;
    console.error(`${label} error ${res.status}`, detail);
    return { ok: false, limited: false, daily: false, skipMs: broken ? BROKEN_SKIP_MS : 0, detail: `HTTP ${res.status}` };
}

function geminiProvider(apiKey: string, model: string): Provider {
    return {
        id: model,
        label: `Gemini ${model}`,
        async generate(prompt) {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.8,   // some variety, so results with the same severity read differently
                        responseMimeType: 'application/json',
                        responseSchema: RESPONSE_SCHEMA,
                    },
                }),
                signal: AbortSignal.timeout(45000),
            });
            if (!res.ok) return failure(res, `Gemini ${model}`);
            const body = await res.json();
            const text = (body?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('');
            return { ok: true, parsed: parseJsonText(text) };
        },
    };
}

// Groq and OpenRouter both use the OpenAI-style chat API
function openAiStyleProvider(id: string, label: string, endpoint: string, apiKey: string, model: string, extraHeaders: Record<string, string> = {}): Provider {
    return {
        id,
        label,
        async generate(prompt) {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...extraHeaders },
                body: JSON.stringify({
                    model,
                    temperature: 0.8,
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: `${SYSTEM_PROMPT}\n\n${JSON_SHAPE}` },
                        { role: 'user', content: prompt },
                    ],
                }),
                signal: AbortSignal.timeout(45000),
            });
            if (!res.ok) return failure(res, label);
            const body = await res.json();
            const text = String(body?.choices?.[0]?.message?.content ?? '');
            return { ok: true, parsed: parseJsonText(text) };
        },
    };
}

function configuredProviders(): Provider[] {
    const env = (k: string) => Deno.env.get(k) || '';
    const list: Provider[] = [];
    if (env('GEMINI_API_KEY')) {
        list.push(geminiProvider(env('GEMINI_API_KEY'), env('GEMINI_MODEL') || 'gemini-2.5-flash'));
        list.push(geminiProvider(env('GEMINI_API_KEY'), env('GEMINI_LITE_MODEL') || 'gemini-2.5-flash-lite'));
    }
    if (env('GROQ_API_KEY')) {
        const model = env('GROQ_MODEL') || 'llama-3.3-70b-versatile';
        list.push(openAiStyleProvider(`groq/${model}`, `Groq ${model}`,
            'https://api.groq.com/openai/v1/chat/completions', env('GROQ_API_KEY'), model));
    }
    if (env('OPENROUTER_API_KEY')) {
        const model = env('OPENROUTER_MODEL') || 'meta-llama/llama-3.3-70b-instruct:free';
        list.push(openAiStyleProvider(`openrouter/${model}`, `OpenRouter ${model}`,
            'https://openrouter.ai/api/v1/chat/completions', env('OPENROUTER_API_KEY'), model,
            { 'X-Title': 'HeatTrack' }));
    }
    return list;
}

// A usable answer has a headline, actions and prevention steps
function toRecommendation(parsed: Record<string, unknown>, model: string) {
    const rec = {
        action: cleanText(parsed.action, 120),
        category: CATEGORIES.includes(String(parsed.category)) ? String(parsed.category) : 'Suggested Action',
        tip: cleanText(parsed.tip, 200),
        explanation: cleanText(parsed.explanation, 500),
        suggested_actions: cleanList(parsed.suggested_actions, 5),
        prevention: cleanList(parsed.prevention, 5),
        environmental_insights: cleanList(parsed.environmental_insights, 3),
        temperature_guidance: cleanList(parsed.temperature_guidance, 3),
        model,
        generated_at: new Date().toISOString(),
    };
    return rec.action && rec.suggested_actions.length && rec.prevention.length ? rec : null;
}

// Try each provider in order until one gives a usable, non-repeated answer
async function generateRecommendation(providers: Provider[], prompt: string, usedHeadlines: Set<string>) {
    const tried: string[] = [];
    let anyLimited = false;
    let allLimitedDaily = true;

    for (const p of providers) {
        if ((skipUntil[p.id] || 0) > Date.now()) {
            tried.push(`${p.id}: skipped (limit reached earlier)`);
            continue;
        }
        let outcome: Outcome;
        try {
            outcome = await p.generate(prompt);
        } catch (e) {
            outcome = { ok: false, limited: false, daily: false, skipMs: 0, detail: String(e) };
        }
        if (!outcome.ok) {
            if (outcome.skipMs) skipUntil[p.id] = Date.now() + outcome.skipMs;
            if (outcome.limited) anyLimited = true;
            if (!(outcome.limited && outcome.daily)) allLimitedDaily = false;
            tried.push(`${p.id}: ${outcome.limited ? (outcome.daily ? 'daily limit' : 'per-minute limit') : outcome.detail}`);
            continue;
        }

        let rec = toRecommendation(outcome.parsed, p.id);
        if (!rec) {
            allLimitedDaily = false;
            tried.push(`${p.id}: incomplete answer`);
            continue;
        }
        // Same headline as an earlier result: ask this provider once more for a different one
        if (usedHeadlines.has(rec.action.toLowerCase())) {
            try {
                const again = await p.generate(`${prompt}\n\nYour headline "${rec.action}" was already used for another result. Write a different, unique recommendation.`);
                if (again.ok) rec = toRecommendation(again.parsed, p.id) || rec;
            } catch (_) { /* keep the first answer */ }
        }
        return { rec, tried };
    }
    return { rec: null, tried, anyLimited, allLimitedDaily };
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'Use POST' });

    const providers = configuredProviders();
    if (!providers.length) {
        return json(503, { error: 'not_configured', message: 'Set GEMINI_API_KEY (and optionally GROQ_API_KEY / OPENROUTER_API_KEY)' });
    }

    let analyticsId: number;
    try {
        analyticsId = Number((await req.json())?.analytics_id);
    } catch (_) {
        return json(400, { error: 'Send JSON { "analytics_id": <id> }' });
    }
    if (!Number.isFinite(analyticsId)) return json(400, { error: 'analytics_id must be a number' });

    const url = Deno.env.get('SUPABASE_URL')!;
    // Reads go through the caller's own session, so row-level security applies
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
        auth: { persistSession: false },
    });
    // Only used to save the answer on a row the caller was allowed to read
    const adminClient = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    const { data: row, error: rowError } = await userClient
        .from('analytics').select('*').eq('id', analyticsId).maybeSingle();
    if (rowError) return json(500, { error: 'Could not read the result', message: rowError.message });
    if (!row) return json(404, { error: 'Result not found' });
    if (row.ai_recommendation) return json(200, { recommendation: row.ai_recommendation, cached: true });

    const severity = String(row.severity || '').toUpperCase();
    if (!GUIDELINES[severity]) return json(422, { error: `Unknown severity ${row.severity}` });

    const interval = num(row.interval_minutes) ?? 30;
    const at = new Date(row.timestamp);
    const from = new Date(at.getTime() - interval * 60 * 1000);

    // Air readings of this interval (peak and latest), the previous result for the
    // trend, and the latest recommendations so the new one is not a repeat
    const [peakRes, latestRes, prevRes, recentRes] = await Promise.all([
        userClient.from('environment').select('temperature, humidity, timestamp')
            .eq('userid', row.userid).gte('timestamp', from.toISOString()).lte('timestamp', at.toISOString())
            .order('temperature', { ascending: false }).limit(1).maybeSingle(),
        userClient.from('environment').select('temperature, humidity, timestamp')
            .eq('userid', row.userid).lte('timestamp', at.toISOString())
            .order('timestamp', { ascending: false }).limit(1).maybeSingle(),
        userClient.from('analytics').select('severity, highest_body_temperature, average_body_temperature, duck_count, timestamp')
            .eq('userid', row.userid).eq('interval_minutes', interval).lt('timestamp', at.toISOString())
            .order('timestamp', { ascending: false }).limit(1).maybeSingle(),
        userClient.from('analytics').select('ai_recommendation')
            .eq('userid', row.userid).neq('id', analyticsId).not('ai_recommendation', 'is', null)
            .order('timestamp', { ascending: false }).limit(6),
    ]);
    const recent = (recentRes.data || []).map((r) => r.ai_recommendation).filter(Boolean);
    const peak = peakRes.data;
    const latest = latestRes.data;
    const prev = prevRes.data;

    const high = num(row.highest_body_temperature);
    const avg = num(row.average_body_temperature);
    const low = num(row.lowest_body_temperature);
    const prevHigh = prev ? num(prev.highest_body_temperature) : null;

    const prompt = [
        `RESULT (${interval}-minute interval ending ${at.toISOString()})`,
        `Severity (from trained model): ${severity}`,
        `Status: ${row.status ?? 'unknown'}`,
        `Ducks detected: ${num(row.duck_count) ?? 'unknown'}`,
        `Estimated surface temperature: lowest ${fmt(low, '°C')}, average ${fmt(avg, '°C')}, highest ${fmt(high, '°C')}`,
        `Peak air temperature in the interval: ${fmt(num(peak?.temperature), '°C')} with humidity ${fmt(num(peak?.humidity), '%')}`,
        `Latest air reading: ${fmt(num(latest?.temperature), '°C')}, humidity ${fmt(num(latest?.humidity), '%')}`,
        prev
            ? `Previous result: severity ${prev.severity}, highest body ${fmt(prevHigh, '°C')}, ${num(prev.duck_count) ?? '?'} ducks`
              + (prevHigh !== null && high !== null ? ` (surface temperature change ${high - prevHigh >= 0 ? '+' : ''}${(high - prevHigh).toFixed(1)}°C)` : '')
            : 'Previous result: none',
        `Recheck time for this severity: ${RECHECK[severity]}`,
        '',
        `GUIDELINE ACTIONS for ${severity}:`,
        ...GUIDELINES[severity].map((g) => `- ${g}`),
        '',
        'RECENT RECOMMENDATIONS (already shown for other results; do NOT repeat them):',
        ...(recent.length
            ? recent.map((r) => `- headline "${r.action}"; tip "${r.tip}"; first action "${r.suggested_actions?.[0] ?? ''}"; first prevention "${r.prevention?.[0] ?? ''}"`)
            : ['- none yet']),
    ].join('\n');
    const usedHeadlines = new Set(recent.map((r) => String(r.action || '').trim().toLowerCase()));

    const result = await generateRecommendation(providers, prompt, usedHeadlines);
    if (!result.rec) {
        console.error('No AI provider could answer', result.tried);
        if (result.anyLimited) {
            // daily: every provider that answered is out for the day, so the website waits longer
            return json(429, { error: 'rate_limited', daily: !!result.allLimitedDaily, tried: result.tried });
        }
        return json(502, { error: 'ai_failed', tried: result.tried });
    }
    if (result.tried.length) console.log(`Answered by ${result.rec.model} after: ${result.tried.join('; ')}`);

    const { error: saveError } = await adminClient
        .from('analytics').update({ ai_recommendation: result.rec })
        .eq('id', analyticsId).is('ai_recommendation', null);
    if (saveError) console.error('Could not save the recommendation', saveError);

    return json(200, { recommendation: result.rec, cached: false });
});
