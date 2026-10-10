// HeatTrack website settings.
// heattrack.html loads this file BEFORE script.js.
//
// Only the PUBLIC anon / publishable key belongs here. It is meant to be visible
// in the browser; your data is protected by Supabase's row-level security rules.
// NEVER put a secret (sb_secret_...) or service_role key in this file.
window.HEATTRACK_CONFIG = Object.freeze({
    supabaseUrl: 'https://yrcsrbejeubfswvrezzd.supabase.co',
    supabaseKey: 'sb_publishable_-R6aL3ZcZy8ncFrovcu0mA_KlowQiyr',
});