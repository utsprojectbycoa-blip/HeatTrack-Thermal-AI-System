(function () {
    'use strict';

    const STORAGE_KEY = 'heattrack.language';
    // Filipino (fil) UI strings. Kept close to the English length so buttons,
    // chips and cards keep the same size and wrapping in both languages.
    // Glossary: Status = Katayuan · Urgency Level = Antas ng Urgency ·
    // Routine/Monitor/Urgent/Critical = Regular/Bantayan/Agaran/Kritikal ·
    // Thermal Comfort = Komportable · reading = sukat · record = tala ·
    // surface temp = temperatura ng itik · ambient = paligid · humid = maalinsangan.
    const translations = {
        // Language & app name
        'Language': 'Wika',
        'App language': 'Wika ng app',
        'English': 'English',
        'Filipino': 'Filipino',
        'HeatTrack': 'HeatTrack',
        'HEATTRACK': 'HEATTRACK',
        'HeatTrack - Thermal AI System': 'HeatTrack - Thermal AI System',
        'HeatTrack — Thermal AI System': 'HeatTrack — Thermal AI System',
        'THERMAL AI SYSTEM': 'THERMAL AI SYSTEM',
        'Thermal AI System': 'Thermal AI System',

        // Auth
        'Create Account': 'Gumawa ng Account',
        'Register your information to manage monitoring system.': 'Magparehistro para magamit ang monitoring system.',
        'Sign In': 'Mag-log In',
        'Log in to manage heat stress detection.': 'Mag-log in para bantayan ang heat stress.',
        'First Name': 'Pangalan',
        'Last Name': 'Apelyido',
        'Username': 'Username',
        'Email': 'Email',
        'Password': 'Password',
        'Confirm Password': 'Ulitin ang Password',
        'Device ID': 'Device ID',
        'Device API Key': 'Device API Key',
        'Sign up': 'Mag-sign up',
        'Log in': 'Mag-log in',
        'Username or Email': 'Username o Email',
        'Forgot password?': 'Nakalimutan ang password?',
        'Hello, Quack!': 'Kumusta, Quack!',
        'Already have an account?': 'May account ka na?',
        'Welcome Back!': 'Maligayang Pagbalik!',
        "Don't have an account yet?": 'Wala ka pang account?',
        'Forgot Password?': 'Nakalimutan ang Password?',
        'Send Reset Link': 'Ipadala ang Link',
        'Remember your password?': 'Naaalala mo na?',
        'Show password': 'Ipakita ang password',
        'Hide password': 'Itago ang password',
        'Show API key': 'Ipakita ang API key',
        'Hide API key': 'Itago ang API key',
        'first name': 'pangalan',
        'last name': 'apelyido',
        'username': 'username',
        'password': 'password',
        'confirm password': 'ulitin ang password',
        'current password': 'kasalukuyang password',
        'new password': 'bagong password',
        'device API key': 'device API key',
        'example@gmail.com': 'halimbawa@gmail.com',
        'username or example@gmail.com': 'username o halimbawa@gmail.com',
        'Letters and spaces only (max 20 characters)': 'Letra at espasyo lang (hanggang 20 karakter)',
        'Letters and spaces only (max 25 characters)': 'Letra at espasyo lang (hanggang 25 karakter)',
        'Letters and spaces only (max 30 characters)': 'Letra at espasyo lang (hanggang 30 karakter)',
        'No spaces (max 20 characters)': 'Walang espasyo (hanggang 20 karakter)',
        '3-digit device number from 001 to 999, e.g. 001': '3-digit na numero mula 001 hanggang 999, hal. 001',
        'Device ID number (HT-PDCK- followed by 3 digits)': 'Device ID (HT-PDCK- at 3 digit)',
        '8-64 characters: letters, numbers, - and _': '8–64 karakter: letra, numero, - at _',
        '8-16 characters': '8–16 karakter',
        'At least 1 uppercase letter': 'Kahit 1 malaking titik',
        'At least 1 lowercase letter': 'Kahit 1 maliit na titik',
        'At least 1 special character': 'Kahit 1 simbolo',
        'At least 1 numerical digit': 'Kahit 1 numero',
        'Password requirements': 'Mga kailangan sa password',
        'Password strength:': 'Lakas ng password:',
        'Not entered': 'Wala pa',
        'Weak': 'Mahina',
        'Moderate': 'Katamtaman',
        'Strong': 'Malakas',
        'Very strong': 'Napakalakas',
        'New Password': 'Bagong Password',
        'Current Password': 'Kasalukuyang Password',
        'Confirm New Password': 'Ulitin ang Bagong Password',
        'Optional. Leave these empty to keep your current password.': 'Opsyonal. Iwanang blangko para hindi mapalitan ang password.',
        'Re-enter new password': 'Ulitin ang bagong password',
        'Update Password': 'I-update ang Password',
        'Signing in': 'Nagla-log in',
        'Signing you in...': 'Nagla-log in...',
        'Logging out...': 'Nagla-log out...',
        'Resetting your password…': 'Nire-reset ang password…',

        // Navigation & common
        'Dashboard': 'Dashboard',
        'Users': 'Mga User',
        'Admin': 'Admin',
        'Home': 'Home',
        'Analytics': 'Analytics',
        'About': 'Tungkol',
        'About HeatTrack': 'Tungkol sa HeatTrack',
        'Profile': 'Profile',
        'Frequently Asked Questions': 'Mga Madalas Itanong',
        'Settings': 'Mga Setting',
        'Alerts': 'Mga Alert',
        'Alerts & Notifications': 'Mga Alert at Abiso',
        'Alert Notifications': 'Abiso ng Alert',
        'Camera Streams': 'Stream ng Camera',
        'Both cameras active': 'Aktibo ang dalawang camera',
        'Push & Sound alerts': 'Push at tunog na alert',
        'Read all': 'Basahin lahat',
        'No alerts yet': 'Wala pang alert',
        'No alert yet': 'Wala pang alert',
        'Notification': 'Abiso',
        'Dismiss': 'Isara',
        'View details': 'Tingnan ang detalye',
        'Prev': 'Nakaraan',
        'Next': 'Susunod',
        'Page': 'Pahina',
        'Search': 'Hanapin',
        'Menu': 'Menu',
        'Close': 'Isara',
        'No': 'Hindi',
        'Confirm': 'Kumpirmahin',
        'Confirm action': 'Kumpirmahin',
        'Cancel': 'Ikansela',
        'Clear': 'I-clear',
        'All': 'Lahat',
        'Generate': 'Bumuo',
        'Save Changes': 'I-save',
        'Actions': 'Aksyon',
        'Status': 'Katayuan',
        'Site': 'Site',
        'Primary': 'Pangunahin',
        'Not set': 'Wala pa',
        'Not provided': 'Wala',
        'Not linked': 'Hindi naka-link',
        'Not available': 'Wala',
        'Offline': 'Offline',
        'Loading…': 'Naglo-load…',
        'Just now': 'Ngayon lang',
        'Updated': 'Na-update',
        'From': 'Mula',
        'Until': 'Hanggang',
        'Farmers': 'Mga Magsasaka',
        'Support': 'Suporta',
        'Account access': 'Access sa account',
        'HeatTrack account access': 'Access sa HeatTrack account',
        'HeatTrack admin interface': 'Admin interface ng HeatTrack',
        'Admin navigation': 'Admin navigation',
        'Admin primary': 'Admin navigation',
        'Toggle admin navigation': 'Buksan/isara ang admin menu',
        'Toggle navigation menu': 'Buksan/isara ang menu',
        'https://...': 'https://...',
        'Sept 30, 2026, 12:00:00 PM': 'Set 30, 2026, 12:00:00 PM',
        'September 30, 2026, 12:00:00 PM': 'Setyembre 30, 2026, 12:00:00 PM',

        // Page titles
        'HeatTrack — Create Account': 'HeatTrack — Gumawa ng Account',
        'HeatTrack — Sign In': 'HeatTrack — Mag-log In',
        'HeatTrack — Forgot Password': 'HeatTrack — Nakalimutan ang Password',
        'HeatTrack — Home': 'HeatTrack — Home',
        'HeatTrack — Analytics': 'HeatTrack — Analytics',
        'HeatTrack — About': 'HeatTrack — Tungkol',
        'HeatTrack — Profile': 'HeatTrack — Profile',
        'HeatTrack — Frequently Asked Questions': 'HeatTrack — Mga Madalas Itanong',
        'HeatTrack — Admin': 'HeatTrack — Admin',
        'HeatTrack — Admin Sign In': 'HeatTrack — Admin Log In',

        // Profile & log out
        'Account Information': 'Impormasyon ng Account',
        'Edit Profile': 'I-edit ang Profile',
        'Change Password': 'Palitan ang Password',
        'Log Out': 'Mag-log Out',
        'Yes, log out': 'Oo, mag-log out',
        'Log out?': 'Mag-log out?',
        'Are you sure you want to log out of HeatTrack?': 'Sigurado ka bang mag-log out sa HeatTrack?',
        'Welcome back,': 'Kumusta,',
        'View and update your account information.': 'Tingnan at i-update ang iyong account.',
        'View and update your admin account.': 'Tingnan at i-update ang admin account mo.',
        'The Device ID cannot be changed': 'Hindi mapapalitan ang Device ID',
        'The API key is hidden and cannot be changed': 'Nakatago at hindi mapapalitan ang API key',

        // Admin
        'Admin · User Management': 'Admin · Pamamahala ng User',
        'Pending Requests': 'Mga Nakabinbing Request',
        'Pending requests': 'Mga nakabinbing request',
        'No pending requests': 'Walang nakabinbing request',
        'Pending': 'Nakabinbin',
        'Approved': 'Aprubado',
        'Accept': 'Tanggapin',
        'Reject': 'Tanggihan',
        'Full Name': 'Buong Pangalan',
        'Date Registered': 'Petsa ng Rehistro',
        'Registered Devices': 'Rehistradong Device',
        'Total Users': 'Kabuuang User',
        'All accounts in the system': 'Lahat ng account sa system',
        'Approved Users': 'Aprubadong User',
        'Accounts cleared for access': 'Mga account na may access',
        'Accounts waiting for review': 'Naghihintay ng pagsusuri',
        'Sign-ups waiting for your approval': 'Naghihintay ng iyong pag-apruba',
        'Review all': 'Suriin lahat',
        'Recent Sign-ups': 'Mga Bagong Sign-up',
        'Latest accounts registered in HeatTrack': 'Pinakabagong account sa HeatTrack',
        'View all': 'Tingnan lahat',
        'Account Status': 'Katayuan ng Account',
        'Breakdown of approved and pending accounts': 'Aprubado at nakabinbing account',
        'of accounts approved': 'ng mga account ang aprubado',
        'Devices in the registry': 'Mga device sa rehistro',
        'Review sign-up requests and keep the user list accurate and secure.': 'Suriin ang mga sign-up request at panatilihing tama at ligtas ang listahan ng user.',
        'Review accounts waiting for approval.': 'Suriin ang mga account na naghihintay ng pag-apruba.',
        'Account Requests': 'Mga Account Request',
        'Account summary': 'Buod ng account',
        'Approval rate': 'Approval rate',
        'User Accounts': 'Mga User Account',
        'Manage approved HeatTrack users.': 'Pamahalaan ang mga aprubadong user ng HeatTrack.',
        'Approved Accounts': 'Aprubadong Account',
        'Showing 0 of 0 requests': 'Ipinapakita ang 0 sa 0 request',
        'Showing 0 of 0 users': 'Ipinapakita ang 0 sa 0 user',
        'Showing 0 records': 'Ipinapakita ang 0 tala',
        'Device Registry': 'Rehistro ng Device',
        'Register a New Device': 'Magrehistro ng Device',
        'Register Device': 'Irehistro',
        'Linked': 'Naka-link',
        'Available': 'Bakante',
        'Trash': 'Basurahan',
        'Edit User': 'I-edit ang User',
        'Edit Device': 'I-edit ang Device',
        'New Device API Key': 'Bagong Device API Key',
        'Device URL': 'Device URL',
        'Search requests': 'Hanapin ang request',
        'Search users': 'Hanapin ang user',
        'Search devices': 'Hanapin ang device',
        'Filter devices': 'I-filter ang device',
        'Enter the device API key': 'Ilagay ang device API key',
        'Leave blank to keep the current key': 'Iwanang blangko para hindi mapalitan',
        'Starts with http:// or https:// (max 255 characters)': 'Nagsisimula sa http:// o https:// (hanggang 255 karakter)',
        'Verifying admin access...': 'Sinusuri ang admin access...',
        'Sort order:': 'Pagkakasunod-sunod:',

        // Dashboard
        'Monitoring Dashboard': 'Monitoring Dashboard',
        'RGB Monitor': 'Monitor ng RGB',
        'CAM-01 | RGB': 'CAM-01 | RGB',
        'Thermal Monitor': 'Monitor ng Thermal',
        'CAM-02 | THERMAL': 'CAM-02 | THERMAL',
        'DHT22 Sensor Readings': 'Sukat ng DHT22 Sensor',
        'Temperature': 'Temperatura',
        'Humidity': 'Halumigmig',
        'Temperature (°C)': 'Temperatura (°C)',
        'Humidity (%)': 'Halumigmig (%)',
        'Temperature level': 'Antas ng temperatura',
        'Humidity level': 'Antas ng halumigmig',
        'Duck KPIs': 'KPI ng Itik',
        'Ducks: --': 'Itik: --',
        'Thermal Comfort: --': 'Komportable: --',
        'Mild Heat Stress: --': 'Banayad na Heat Stress: --',
        'Moderate Heat Stress: --': 'Katamtamang Heat Stress: --',
        'Severe Heat Stress: --': 'Matinding Heat Stress: --',
        'Click to expand': 'I-click para palakihin',
        'Click to expand fullscreen': 'I-click para i-fullscreen',
        'LIVE': 'LIVE',
        'ACTIVE': 'AKTIBO',
        'INACTIVE': 'DI AKTIBO',
        'Connecting to camera...': 'Kumokonekta sa camera...',
        'Camera not connected': 'Hindi konektado ang camera',
        'Camera not responding...': 'Hindi tumutugon ang camera...',
        'Camera streams disabled': 'Naka-off ang Stream ng Camera',
        'Camera streams are off': 'Naka-off ang Stream ng Camera',
        'Click to exit fullscreen': 'I-click para lumabas sa fullscreen',
        'RGB camera live feed': 'Live feed ng RGB camera',
        'Thermal camera live view with duck surface temperatures': 'Live view ng thermal camera na may temperatura ng itik',
        'Online': 'Online',
        'Checking...': 'Sinusuri...',
        'Results': 'Mga Resulta',
        'Show More Results': 'Ipakita ang Iba Pang Resulta',
        'Show More Notifications': 'Ipakita ang Iba Pang Abiso',
        'Show More Requests': 'Ipakita ang Iba Pang Request',
        'Monitoring': 'Pagbabantay',
        'Thermal': 'Thermal',
        'Ducks': 'Itik',
        'Barn': 'Kulungan',
        '999 ducks': '999 itik',
        'Stale reading': 'Lumang sukat',
        'No new sensor reading in the last 15 minutes. Check the device.': 'Walang bagong sukat ng sensor sa nakaraang 15 minuto. Suriin ang device.',

        // Status & urgency
        'Thermal Comfort': 'Komportable',
        'Mild Heat Stress': 'Banayad na Heat Stress',
        'Moderate Heat Stress': 'Katamtamang Heat Stress',
        'Severe Heat Stress': 'Matinding Heat Stress',
        'THERMAL COMFORT': 'KOMPORTABLE',
        'MILD HEAT STRESS': 'BANAYAD NA HEAT STRESS',
        'MODERATE HEAT STRESS': 'KATAMTAMANG HEAT STRESS',
        'SEVERE HEAT STRESS': 'MATINDING HEAT STRESS',
        'Critical': 'Kritikal',
        'CRITICAL': 'KRITIKAL',
        'Urgent': 'Agaran',
        'URGENT': 'AGARAN',
        'Monitor': 'Bantayan',
        'MONITOR': 'BANTAYAN',
        'Routine': 'Regular',
        'ROUTINE': 'REGULAR',
        'HIGH': 'AGARAN',
        'MODERATE': 'BANTAYAN',
        'LOW': 'REGULAR',
        '↑ Critical': '↑ Kritikal',
        '↑ Monitor': '↑ Bantayan',
        '↑ Urgent': '↑ Agaran',
        '↓ Monitor': '↓ Bantayan',
        '↓ Routine': '↓ Regular',
        'Usually': 'Madalas',
        'Usual level': 'Karaniwang antas',
        'Always': 'Palaging',
        'Urgency:': 'Urgency:',
        'Urgency Level': 'Antas ng Urgency',
        'Urgency Levels': 'Antas ng Urgency',
        'Heat stress status and urgency levels': 'Katayuan ng heat stress at antas ng urgency',

        // Weather
        'Heat index': 'Heat index',
        'Risk levels by heat index': 'Antas ng panganib ayon sa heat index',
        'Low': 'Mababa',
        'Below 27°C': 'Mababa sa 27°C',
        '27–32°C': '27–32°C',
        'High': 'Mataas',
        '33–41°C': '33–41°C',
        '42°C and above': '42°C pataas',
        'Weather': 'Panahon',
        'Locating…': 'Hinahanap…',
        'Fetching weather…': 'Kinukuha ang panahon…',
        'Location unavailable': 'Walang lokasyon',
        'Weather unavailable. Retrying in 15 minutes.': 'Walang datos ng panahon. Susubok muli sa 15 minuto.',
        'Disclaimer:': 'Paalala:',
        'Disclaimer': 'Paalala',
        'Forecast-based data from Open-Meteo, refreshed at most every 15 minutes. It may differ from actual conditions. Use it as a general guide only.': 'Forecast mula sa Open-Meteo, ina-update hanggang bawat 15 minuto. Maaaring iba ito sa aktuwal na lagay. Gamitin lang bilang pangkalahatang gabay.',
        'Results are assistive only. Confirm with on-site observation and follow farm protocol before critical actions.': 'Pantulong lang ang mga resulta. Kumpirmahin nang personal at sundin ang protocol ng farm bago gumawa ng malaking hakbang.',

        // About
        'Important Disclaimer': 'Mahalagang Paalala',
        'This page is for orientation only. AI detections and charts in the app are assistive tools and may contain errors. Always confirm findings with on-site observation and follow your farm or veterinarian protocols before taking critical action.': 'Gabay lang ang pahinang ito. Pantulong ang mga AI detection at chart sa app at maaaring magkamali. Laging kumpirmahin nang personal at sundin ang protocol ng farm o ng beterinaryo bago gumawa ng malaking hakbang.',
        'Core Capabilities': 'Pangunahing Kakayahan',
        'What HeatTrack Delivers': 'Ang Hatid ng HeatTrack',
        'Dual-Camera Detection': 'Dual-Camera Detection',
        "AI finds and counts the ducks; the thermal feed shows each duck's estimated surface temperature.": 'Hinahanap at binibilang ng AI ang mga itik; ipinapakita ng thermal feed ang tinatayang temperatura ng bawat itik.',
        'Open Dashboard': 'Buksan ang Dashboard',
        'Environmental Sensing': 'Sukat ng Paligid',
        'The DHT22 reads the ambient temperature and humidity about every 10 seconds.': 'Sinusukat ng DHT22 ang temperatura at halumigmig ng paligid kada ~10 segundo.',
        'View sensor readings': 'Tingnan ang sukat ng sensor',
        'Detection Analytics': 'Detection Analytics',
        'Every 30-minute reading is saved, charted, and exportable as an Excel report.': 'Sine-save at naka-chart ang bawat 30-minutong sukat, at mae-export bilang Excel report.',
        'Open Analytics': 'Buksan ang Analytics',
        'Urgency-Based Alerts': 'Alert Ayon sa Urgency',
        'Urgent and Critical readings raise a pop-up alert and appear under the bell icon.': 'May pop-up alert ang mga sukat na Agaran at Kritikal, at makikita ito sa icon ng kampana.',
        'View alerts': 'Tingnan ang mga alert',
        'Heat Stress Level Reference': 'Gabay sa Antas ng Heat Stress',
        'Status, Urgency & Thermal Colors': 'Katayuan, Urgency at Kulay Thermal',
        'Status & Urgency Levels': 'Katayuan at Antas ng Urgency',
        'Surface Temperature & Status': 'Temperatura ng Itik at Katayuan',
        '↑ Very hot, humid air · ↓ Cool air': '↑ Napakainit at maalinsangan · ↓ Malamig',
        '↑ Very hot, humid air  ·  ↓ Cool air': '↑ Napakainit at maalinsangan  ·  ↓ Malamig',
        'Thermal Color Spectrum': 'Mga Kulay Thermal',
        'Thermal Color Spectrum, hottest at the top': 'Spectrum ng kulay thermal, pinakamainit sa itaas',
        'Hotter at the top · cooler at the bottom': 'Mainit sa itaas · malamig sa ibaba',
        'Yellow to White — Hottest': 'Dilaw–Puti — Pinakamainit',
        'Orange — Hot': 'Kahel — Mainit',
        'Red — Warm': 'Pula — Maligamgam',
        'Black to Purple — Coolest': 'Itim–Lila — Pinakamalamig',
        '35.7°C or below.': '35.7°C pababa.',
        'Temperature remains within the normal, comfortable range.': 'Normal at komportable ang temperatura.',
        '35.8°C to 43.6°C.': '35.8°C hanggang 43.6°C.',
        'Temperature indicates increasing levels of heat stress.': 'Tumitindi na ang heat stress.',
        '43.7°C to 44.9°C.': '43.7°C hanggang 44.9°C.',
        'Temperature indicates significant heat stress and increased risk.': 'Malubhang heat stress, mas mataas na panganib.',
        '45.0°C or above.': '45.0°C pataas.',
        'Temperature indicates dangerously high heat stress.': 'Mapanganib na ang taas ng heat stress.',
        ', regardless of environmental conditions.': ', anuman ang lagay ng paligid.',
        'in very hot, humid conditions;': 'sa sobrang alinsangan;',
        'in very hot, humid conditions.': 'sa sobrang alinsangan.',
        'in cool air.': 'sa malamig.',
        'Status by highest surface temperature: 35.7°C or below is Thermal Comfort, usually Routine, Monitor in hot humid air. 35.8 to 43.6°C is Mild Heat Stress, usually Monitor, Urgent in hot humid air, Routine in cool air. 43.7 to 44.9°C is Moderate Heat Stress, usually Urgent, Critical in hot humid air, Monitor in cool air. 45.0°C or above is Severe Heat Stress, always Critical.': 'Katayuan ayon sa pinakamataas na temperatura ng itik: 35.7°C pababa ay Komportable, kadalasang Regular, Bantayan kapag mainit at maalinsangan. 35.8 hanggang 43.6°C ay Banayad na Heat Stress, kadalasang Bantayan, Agaran kapag mainit at maalinsangan, Regular kapag malamig. 43.7 hanggang 44.9°C ay Katamtamang Heat Stress, kadalasang Agaran, Kritikal kapag mainit at maalinsangan, Bantayan kapag malamig. 45.0°C pataas ay Matinding Heat Stress, palaging Kritikal.',
        'Research Team': 'Pangkat ng Mananaliksik',
        'Bachelor of Science in Computer Engineering · University of Rizal System – Morong Campus': 'Batsilyer ng Agham sa Computer Engineering · University of Rizal System – Kampus ng Morong',
        'Research Adviser': 'Tagapayo sa Pananaliksik',
        'Research Leader': 'Pinuno ng Pananaliksik',
        'Researcher': 'Mananaliksik',
        'Pateros Duckery AI-Integrated Assistive Monitoring System for Heat Stress Detection': 'Pateros Duckery AI-Integrated Assistive Monitoring System for Heat Stress Detection',
        'Pateros Duckery AI-Integrated Assistive Monitoring System for Heat Stress Detection © 2026': 'Pateros Duckery AI-Integrated Assistive Monitoring System for Heat Stress Detection © 2026',
        'Pateros Duckery AI-Integrated Assistive Monitoring System for Heat Stress Detection · 2026': 'Pateros Duckery AI-Integrated Assistive Monitoring System for Heat Stress Detection · 2026',

        // FAQ
        'Common questions about monitoring, thermal detection, results,': 'Mga karaniwang tanong tungkol sa pagbabantay, thermal detection, resulta,',
        'alerts, and duck protection.': 'alert at pag-aalaga sa itik.',
        'Getting Started': 'Pagsisimula',
        'How do I use HeatTrack?': 'Paano gamitin ang HeatTrack?',
        'Check the': 'Tingnan ang',
        'dashboard for the camera feeds, ambient conditions, duck counts, and detection results, and': 'dashboard para sa camera feed, lagay ng paligid, bilang ng itik at resulta ng detection, at ang',
        'for the detection history, charts, and Excel reports. Urgent and Critical alerts appear under the bell icon, Settings is under the gear icon, and these questions are under the question mark icon.': 'para sa kasaysayan ng detection, mga chart at Excel report. Nasa icon ng kampana ang mga alert na Agaran at Kritikal, nasa icon ng gear ang Mga Setting, at nasa icon ng tandang pananong ang mga tanong na ito.',
        'How does HeatTrack monitor heat stress in real time?': 'Paano binabantayan ng HeatTrack ang heat stress nang real time?',
        "HeatTrack combines three sources: a live RGB camera where an AI model detects and counts your ducks, a thermal camera that estimates the surface temperature of each duck's body area, and a DHT22 sensor that measures ambient temperature and humidity. At the first detection and every 30 minutes of monitoring after it, HeatTrack rates the ducks' highest surface temperature together with the ambient temperature and humidity, and records a": 'Pinagsasama ng HeatTrack ang tatlong source: live na RGB camera kung saan tinutukoy at binibilang ng AI ang mga itik, thermal camera na tumatantiya sa temperatura ng katawan ng bawat itik, at DHT22 sensor na sumusukat sa temperatura at halumigmig ng paligid. Sa unang detection at kada 30 minuto pagkatapos nito, sinusuri ng HeatTrack ang pinakamataas na temperatura ng mga itik kasama ang temperatura at halumigmig ng paligid, at itinatala ang',
        '(how heat-stressed are the ducks?) and an': '(gaano kalala ang heat stress ng mga itik?) at ang',
        '(how fast should you act?), so you can act before conditions get worse.': '(gaano kabilis dapat kumilos?), para makakilos ka bago lumala ang lagay.',
        'What is thermal detection and how does it work?': 'Ano ang thermal detection at paano ito gumagana?',
        'Thermal detection uses an infrared camera to read the surface temperature of everything in view. HeatTrack finds each duck and reads the temperature of its body area to estimate its surface temperature. On the Thermal Monitor, a': 'Gumagamit ang thermal detection ng infrared camera para basahin ang temperatura sa ibabaw ng lahat ng nasa view. Hinahanap ng HeatTrack ang bawat itik at binabasa ang temperatura ng katawan nito para tantiyahin ang temperatura ng itik. Sa Monitor ng Thermal, ang',
        'white box': 'puting kahon',
        "shows a duck's estimated surface temperature, and a": 'ay nagpapakita ng tinatayang temperatura ng itik, at ang',
        'gray box': 'abong kahon',
        "means that duck could not be measured (at the edge of the frame, too far away, or overlapping another duck). The ducks' lowest, average, and highest surface temperatures are saved with every detection record.": 'ay nangangahulugang hindi nasukat ang itik (nasa gilid ng frame, masyadong malayo, o natatakpan ng ibang itik). Sine-save sa bawat tala ng detection ang pinakamababa, karaniwan at pinakamataas na temperatura ng mga itik.',
        'means that duck could not be measured (at the edge of the frame, too far away, or overlapping another duck). The ducks’ lowest, average, and highest surface temperatures are saved with every detection record.': 'ay nangangahulugang hindi nasukat ang itik (nasa gilid ng frame, masyadong malayo, o natatakpan ng ibang itik). Sine-save sa bawat tala ng detection ang pinakamababa, karaniwan at pinakamataas na temperatura ng mga itik.',
        "The ducks' lowest, average, and highest surface temperatures are saved with every detection record.": 'Sine-save sa bawat tala ng detection ang pinakamababa, karaniwan at pinakamataas na temperatura ng mga itik.',
        'Which part of the duck does the surface temperature come from?': 'Saang bahagi kinukuha ang temperatura ng itik?',
        "The surface temperature is based on the duck's": 'Kinukuha ang temperatura ng itik sa',
        'The surface temperature is based on the duck’s': 'Kinukuha ang temperatura ng itik sa',
        'body area only': 'katawan lang nito',
        '. It is not taken from the head, eyes, bill, wings, or feet, which can read hotter on the thermal view because heat leaves the body there. The status (Thermal Comfort, Mild, Moderate, or Severe Heat Stress) follows the highest surface temperature among the ducks in each reading, and the lowest and average surface temperatures are saved with it.': '. Hindi ito kinukuha sa ulo, mata, tuka, pakpak o paa, na mas mainit sa thermal view dahil doon lumalabas ang init ng katawan. Ang katayuan (Komportable, Banayad, Katamtaman o Matinding Heat Stress) ay batay sa pinakamataas na temperatura ng mga itik sa bawat sukat; sine-save rin ang pinakamababa at karaniwang temperatura.',
        'What do the thermal colors mean?': 'Ano ang ibig sabihin ng mga kulay thermal?',
        'The colors show surface heat on a fixed 25–45°C scale, not a risk rating.': 'Ipinapakita ng mga kulay ang init sa ibabaw sa nakapirming 25–45°C na scale, hindi ang antas ng panganib.',
        'Black to purple (25–30°C)': 'Itim hanggang lila (25–30°C)',
        'is the coolest, usually the floor, water, and shade.': 'ang pinakamalamig, kadalasang sahig, tubig at lilim.',
        'Red (30–35°C)': 'Pula (30–35°C)',
        "is warm, such as a duck's feathered body.": 'ang maligamgam, gaya ng katawan ng itik na may balahibo.',
        'is warm, such as a duck’s feathered body.': 'ang maligamgam, gaya ng katawan ng itik na may balahibo.',
        'Orange (35–40°C)': 'Kahel (35–40°C)',
        'is hot, such as the head, eyes, bill, and legs.': 'ang mainit, gaya ng ulo, mata, tuka at binti.',
        'Yellow to white (40–45°C)': 'Dilaw hanggang puti (40–45°C)',
        "is the hottest spot in view. The heat stress rating comes from the Status and Urgency Level, not from the colors. Always check the thermal view together with the ducks' behavior on the RGB feed.": 'ang pinakamainit na bahagi sa view. Ang antas ng heat stress ay mula sa Katayuan at Antas ng Urgency, hindi sa mga kulay. Laging tingnan ang thermal view kasabay ng kilos ng mga itik sa RGB feed.',
        'is the hottest spot in view. The heat stress rating comes from the Status and Urgency Level, not from the colors. Always check the thermal view together with the ducks’ behavior on the RGB feed.': 'ang pinakamainit na bahagi sa view. Ang antas ng heat stress ay mula sa Katayuan at Antas ng Urgency, hindi sa mga kulay. Laging tingnan ang thermal view kasabay ng kilos ng mga itik sa RGB feed.',
        'AI': 'AI',
        'How do the detection results work?': 'Paano gumagana ang mga resulta ng detection?',
        'The Results panel on the Home dashboard shows one result for every 30-minute reading in which ducks were detected, newest first. Each one shows its status, its surface and ambient temperatures, and its Urgency Level, from Routine to Critical. Tap any card for its Detection Details and Summary.': 'Ipinapakita ng panel na Mga Resulta sa Home ang isang resulta para sa bawat 30-minutong sukat na may natukoy na itik, pinakabago muna. Makikita sa bawat isa ang katayuan, temperatura ng itik at ng paligid, at Antas ng Urgency mula Regular hanggang Kritikal. Pindutin ang card para sa Detalye at Buod ng Detection.',
        'What is the difference between Status and Urgency Level?': 'Ano ang pagkakaiba ng Katayuan at Antas ng Urgency?',
        'The': 'Ang',
        'tells you how much heat stress the ducks are under, strictly from their highest surface temperature on the thermal camera:': 'ang nagsasabi kung gaano kalala ang heat stress ng mga itik, batay lang sa pinakamataas na temperatura ng itik mula sa thermal camera:',
        '(35.7°C or below),': '(35.7°C pababa),',
        '(35.8–43.6°C),': '(35.8–43.6°C),',
        '(43.7–44.9°C), or': '(43.7–44.9°C), o',
        '(45.0°C or above). The': '(45.0°C pataas). Ang',
        '(Routine, Monitor, Urgent, or Critical) tells you how fast to act. It starts at the usual level for the status (Routine, Monitor, Urgent, Critical in the same order), then the ambient temperature and humidity from the DHT22 sensor can move it one level: very hot, humid air raises it and cool air can lower it. So a Mild Heat Stress reading can be Urgent on a hot, humid day. Severe Heat Stress is always Critical. Use the status for a quick check and the urgency level to decide how fast to act.': '(Regular, Bantayan, Agaran o Kritikal) ang nagsasabi kung gaano kabilis dapat kumilos. Nagsisimula ito sa karaniwang antas ng katayuan (Regular, Bantayan, Agaran, Kritikal, sa parehong ayos), at maaari itong iusog nang isang antas ng temperatura at halumigmig ng paligid mula sa DHT22: tumataas ito kapag napakainit at maalinsangan, at maaaring bumaba kapag malamig. Kaya maaaring maging Agaran ang Banayad na Heat Stress sa mainit at maalinsangang araw. Palaging Kritikal ang Matinding Heat Stress. Gamitin ang katayuan para sa mabilisang pagsusuri at ang antas ng urgency para malaman kung gaano kabilis kikilos.',
        'What notifications and alerts does HeatTrack send?': 'Anong mga abiso at alert ang ipinapadala ng HeatTrack?',
        'HeatTrack alerts you when a 30-minute reading has an': 'Nagpapadala ng alert ang HeatTrack kapag ang antas ng urgency ng isang 30-minutong sukat ay',
        'or': 'o',
        'urgency level, whatever its status. The first detection itself does not raise an alert. The alert is added to the': 'anuman ang katayuan nito. Walang alert sa mismong unang detection. Idinaragdag ang alert sa panel na',
        'panel under the bell icon (orange for Urgent, red for Critical), and a pop-up appears on screen for about 5 seconds. Each alert shows the status, surface temperature, urgency level, and time so you can handle the most urgent cases first. Routine and Monitor readings do not trigger alerts.': 'sa icon ng kampana (kahel para sa Agaran, pula para sa Kritikal), at may lalabas na pop-up nang mga 5 segundo. Ipinapakita ng bawat alert ang katayuan, temperatura ng itik, antas ng urgency at oras para maasikaso mo muna ang pinakaapurahang kaso. Walang alert para sa mga sukat na Regular at Bantayan.',
        'Can I control when alerts are delivered?': 'Puwede ko bang kontrolin kung kailan darating ang alert?',
        'Yes. Open the': 'Oo. Buksan ang',
        'panel from the top bar and switch': 'mula sa itaas na bar, at i-on o i-off doon ang',
        'on or off. The same panel turns': 'ayon sa gusto mo. Doon din maaaring i-on o i-off ang',
        'on or off. Alerts work only while Camera Streams is on. Turning Camera Streams off also turns off Alert Notifications. When you turn it back on, Alert Notifications comes back the way you left it. Camera Streams is saved for your account, so turning it on or off on one phone or computer applies on every device signed in to it. Alert Notifications is saved in each browser, so every phone or computer you use keeps its own choice. Keep alerts on during the hottest hours so you can respond quickly when conditions change.': 'sa parehong paraan. Gumagana lang ang alert habang naka-on ang Stream ng Camera. Kapag in-off ang Stream ng Camera, mao-off din ang Abiso ng Alert, at babalik ito sa dati mong setting kapag in-on muli. Naka-save sa iyong account ang Stream ng Camera, kaya nasusunod ito sa lahat ng device na naka-log in dito. Naka-save naman sa bawat browser ang Abiso ng Alert, kaya may sariling setting ang bawat phone o computer. Panatilihing naka-on ang alert sa pinakamainit na oras para mabilis kang makakilos kapag nagbago ang lagay.',
        'How often is monitoring data updated?': 'Gaano kadalas ina-update ang datos?',
        'The camera feeds stream continuously while Camera Streams is on. DHT22 readings are saved about every 10 seconds, updating the Temperature and Humidity tiles on Home and the Environmental Trend chart on Analytics. When ducks are first detected, that detection is added to the Detection Log History. After that, a new Status and Urgency Level reading, marked': 'Tuloy-tuloy ang camera feed habang naka-on ang Stream ng Camera. Sine-save ang sukat ng DHT22 kada ~10 segundo, at ina-update nito ang Temperatura at Halumigmig sa Home at ang chart ng Takbo ng Paligid sa Analytics. Kapag unang natukoy ang mga itik, idinaragdag ito sa Kasaysayan ng Detection. Pagkatapos, may bagong sukat ng Katayuan at Antas ng Urgency, na may markang',
        ', is added 20 minutes later (completing the first 30 minutes of monitoring) and then every 30 minutes, and the KPI cards, Analytics charts, and detection results update to match. Periods with no ducks detected, or with ducks the thermal camera could not measure, add no record, and if there is no reading for 10 minutes (no ducks, or ducks without a surface temperature), the next detection starts a new count.': ', makalipas ang 20 minuto (para mabuo ang unang 30 minuto) at kada 30 minuto pagkatapos, at sabay na naa-update ang mga KPI card, chart sa Analytics at resulta ng detection. Walang naitatalang sukat kapag walang natukoy na itik o hindi ito masukat ng thermal camera, at kapag walang sukat sa loob ng 10 minuto (walang itik o walang temperatura ng itik), magsisimula ng bagong bilang ang susunod na detection.',
        'How does HeatTrack help poultry farmers protect their ducks?': 'Paano tinutulungan ng HeatTrack ang mga nag-aalaga ng itik?',
        'HeatTrack gives poultry and duck farmers earlier visibility into heat risk—combining thermal detection, environmental sensing, and urgency alerts in one dashboard. Teams can intervene sooner, reduce mortality risk during heat spikes, export records for management review, and make data-informed decisions instead of relying on observation alone during the hottest shifts.': 'Mas maagang nakikita ng mga nag-aalaga ng manok at itik ang panganib ng init—pinagsasama ng HeatTrack ang thermal detection, sukat ng paligid at urgency alert sa iisang dashboard. Mas maagang makakakilos ang team, mababawasan ang panganib ng pagkamatay sa biglang pag-init, mae-export ang mga tala para sa pagsusuri, at makapagpapasya batay sa datos sa halip na sa pagmamasid lang sa pinakamainit na oras.',
        'Should I still check my ducks manually if HeatTrack is running?': 'Kailangan ko pa bang personal na tingnan ang mga itik?',
        'Absolutely. HeatTrack is an assistive monitoring tool—not a replacement for on-site welfare checks or veterinarian guidance. AI detections may contain errors. Always confirm alerts with direct observation and follow your farm protocols before taking critical action, especially for Urgent or Critical urgency levels.': 'Oo naman. Pantulong na tool ang HeatTrack—hindi kapalit ng personal na pagsusuri o payo ng beterinaryo. Maaaring magkamali ang AI detection. Laging kumpirmahin nang personal ang mga alert at sundin ang protocol ng farm bago gumawa ng malaking hakbang, lalo na kapag Agaran o Kritikal ang antas ng urgency.',

        // Analytics
        'Review detection records, analyze trends, and generate reports.': 'Suriin ang mga tala, alamin ang takbo at gumawa ng ulat.',
        'Watch the live cameras, barn conditions, and latest results.': 'Bantayan ang live na camera, kalagayan ng kulungan, at bagong resulta.',
        'The main tools HeatTrack uses to watch over your ducks, from detection to alerts.': 'Ang mga pangunahing kasangkapan ng HeatTrack sa pagbabantay ng iyong mga itik, mula detection hanggang alerto.',
        'What each status, urgency level, and thermal color means, so you know when to act.': 'Ang kahulugan ng bawat katayuan, antas ng urgency, at kulay thermal, para malaman mo kung kailan kikilos.',
        'Detection Log History': 'Kasaysayan ng Detection',
        'Generate Report': 'Gumawa ng Ulat',
        'Quick ranges': 'Mabilisang saklaw',
        'Timestamp': 'Petsa at Oras',
        'HeatTrack Analytics Report': 'Ulat ng HeatTrack Analytics',
        'HeatTrack Report': 'Ulat ng HeatTrack',
        'Generated:': 'Ginawa:',
        'Filter:': 'Filter:',
        'Period:': 'Petsa:',
        'Period': 'Petsa',
        'Total Records:': 'Kabuuang Tala:',
        'All Records': 'Lahat ng Tala',
        'Average Body Temperature': 'Karaniwang Temperatura ng Katawan',
        'reading': 'sukat',
        'readings': 'sukat',
        'Duration': 'Tagal',
        'Lowest Surface Temp (°C)': 'Pinakamababang Temperatura ng Itik (°C)',
        'Average Surface Temp (°C)': 'Karaniwang Temperatura ng Itik (°C)',
        'Highest Surface Temp (°C)': 'Pinakamataas na Temperatura ng Itik (°C)',
        'Lowest Surface Temp': 'Pinakamababang Temperatura ng Itik',
        'Average Surface Temp': 'Karaniwang Temperatura ng Itik',
        'Highest Surface Temp': 'Pinakamataas na Temperatura ng Itik',
        'Surface temp': 'Temperatura ng itik',
        'Surface Temperature': 'Temperatura ng Itik',
        'Ambient Temperature': 'Temperatura ng Paligid',
        'Surface Temperature Range': 'Saklaw ng Temperatura ng Itik',
        'No 30 min readings in the selected filters.': 'Walang 30 min na sukat sa napiling filter.',
        '30 min readings only (10 and 20 min readings not included).': '30 min na sukat lang (hindi kasama ang 10 at 20 min).',
        'No detections for the selected events and period.': 'Walang detection sa napiling event at petsa.',
        'Duration: minutes into each 30-minute step of monitoring (10, 20, 30, then 10, 20, 30 again). The first detection is 10 min; after 10 minutes with no reading, counting starts again at 10 min. Totals count the 30 min readings only.': 'Tagal: minuto sa bawat 30-minutong yugto (10, 20, 30, at uulit sa 10, 20, 30). 10 min ang unang detection; kapag 10 minutong walang sukat, babalik sa 10 min ang bilang. 30 min na sukat lang ang binibilang sa kabuuan.',
        'The results, temperatures and averages in this report are generated by an automated system. They are assistive only, may contain errors, and are not a veterinary diagnosis. Always confirm with direct on-site observation of the ducks and follow your farm protocol or veterinary guidance before taking action.': 'Awtomatikong ginawa ng system ang mga resulta, temperatura at average sa ulat na ito. Pantulong lang ang mga ito, maaaring magkamali, at hindi diagnosis ng beterinaryo. Laging kumpirmahin sa personal na pagtingin sa mga itik at sundin ang protocol ng farm o payo ng beterinaryo bago kumilos.',
        'Duck Count': 'Bilang ng Itik',
        'Batch Count': 'Bilang ng Batch',
        'Detection Distribution': 'Distribusyon ng Detection',
        'Environmental Trend': 'Takbo ng Paligid',
        'No DHT22 readings in this period.': 'Walang sukat ng DHT22 sa petsang ito.',
        'All time': 'Lahat',
        'Last 7 days': 'Huling 7 araw',
        'Last 30 days': 'Huling 30 araw',
        'Today': 'Ngayong araw',
        'Pick dates': 'Pumili ng petsa',
        'Filter by': 'I-filter ayon sa',
        'Filter level': 'I-filter ang antas',
        'Choose a period': 'Pumili ng petsa',
        'Choose a period (All time)': 'Pumili ng petsa (Lahat)',
        'Period: All time': 'Petsa: Lahat',
        'Choose a period (Today)': 'Pumili ng petsa (Ngayong araw)',
        'Period: Today': 'Petsa: Ngayong araw',
        'Clear the period (show all time)': 'I-clear ang petsa (ipakita lahat)',
        'Clear the picked dates (show today)': 'I-clear ang petsa (ipakita ngayong araw)',
        'Only the first 1000 readings of this period are shown. Run environment_trend.sql in Supabase to chart the whole period.': 'Unang 1000 sukat lang ang ipinapakita. Patakbuhin ang environment_trend.sql sa Supabase para makita ang buong petsa.',
        'Only the first': 'Unang',
        'readings of this period are shown. Run environment_trend.sql in Supabase to chart the whole period.': 'sukat lang ang ipinapakita. Patakbuhin ang environment_trend.sql sa Supabase para makita ang buong petsa.',
        '30 min': '30 min',

        // Result details (modal)
        'Detection Result': 'Resulta ng Detection',
        'Detection Details': 'Detalye ng Detection',
        'Temperature Readings': 'Sukat ng Temperatura',
        'Detection Count': 'Bilang sa Detection',
        'Summary': 'Buod',
        'These results are assistive only and may contain errors. Always confirm with direct on-site observation of the ducks and follow your established farm protocol or veterinary guidance before taking critical action.': 'Pantulong lang ang mga resultang ito at maaaring magkamali. Laging kumpirmahin sa personal na pagtingin sa mga itik at sundin ang protocol ng farm o payo ng beterinaryo bago gumawa ng malaking hakbang.',
        'duck': 'itik',
        'ducks': 'itik',
        'batch': 'batch',
        'batchs': 'batch',

        // Date picker (calendar)
        'Pick a start date': 'Pumili ng simulang petsa',
        'Now pick the end date': 'Pumili na ng huling petsa',
        'Previous month': 'Nakaraang buwan',
        'Next month': 'Susunod na buwan',
        'Previous year': 'Nakaraang taon',
        'Next year': 'Susunod na taon',
        'Earlier years': 'Mas naunang taon',
        'Later years': 'Mas bagong taon',
        'Days': 'Mga araw',
        'Years': 'Mga taon',
        'Su': 'Li', 'Mo': 'Lu', 'Tu': 'Ma', 'We': 'Mi', 'Th': 'Hu', 'Fr': 'Bi', 'Sa': 'Sa',
        'Jan': 'Ene', 'Feb': 'Peb', 'Mar': 'Mar', 'Apr': 'Abr', 'May': 'May', 'Jun': 'Hun',
        'Jul': 'Hul', 'Aug': 'Ago', 'Sep': 'Set', 'Oct': 'Okt', 'Nov': 'Nob', 'Dec': 'Dis',

        // Detection results & alerts
        'No live detections available yet. As live data arrives, this list will update automatically.': 'Wala pang live na detection. Kusang maa-update ang listahang ito pagdating ng datos.',
        'No detections found. Live event data will populate here once available.': 'Walang detection. Lalabas dito ang live na datos kapag mayroon na.',
        'No ducks detected yet, so there are no results. The first result appears 20 minutes after ducks are first detected, then every 30 minutes.': 'Wala pang natukoy na itik kaya wala pang resulta. Lalabas ang unang resulta 20 minuto matapos unang matukoy ang mga itik, at kada 30 minuto pagkatapos.',
        'Urgency: Urgent. Open the details for the full detection results.': 'Urgency: Agaran. Buksan ang detalye para sa buong resulta.',
        'Urgency: Critical. Open the details for the full detection results.': 'Urgency: Kritikal. Buksan ang detalye para sa buong resulta.',
        'Open the details for the full detection results.': 'Buksan ang detalye para sa buong resulta.',
        'First reading': 'Unang sukat',
        'Previous reading': 'Naunang sukat',
        'No changes': 'Walang pagbabago',
        'Up from': 'Tumaas mula',
        'Down from': 'Bumaba mula',
        'No reading': 'Walang sukat',
        'No air reading during this period': 'Walang sukat ng hangin sa panahong ito',
        'No urgency (no air reading)': 'Walang urgency (walang sukat ng hangin)',
        'Thermal only': 'Thermal lang',
        'Thermal only (air from the thermal camera)': 'Thermal lang (hangin mula sa thermal camera)',
        'No duck detections are available yet, so this is based on barn conditions.': 'Wala pang natukoy na itik, kaya batay ito sa lagay ng kulungan.',
        'Urgency is Critical: act immediately and confirm on-site.': 'Urgency: Kritikal — kumilos agad at kumpirmahin nang personal.',
        'Urgency is Urgent: start cooling now before it gets worse.': 'Urgency: Agaran — magpalamig na bago lumala.',
        'Urgency is Monitor: take preventive steps and watch the trend.': 'Urgency: Bantayan — mag-ingat na at bantayan ang takbo.',
        'Urgency is Routine: keep routine monitoring in place.': 'Urgency: Regular — ituloy ang regular na pagbabantay.',
        'No air (temperature and humidity) reading during this period, so there is no urgency level; follow the Thermal Comfort status.': 'Walang sukat ng hangin (temperatura at halumigmig) sa panahong ito kaya walang antas ng urgency; sundin ang katayuang Komportable.',
        'The barn is at 35.0°C; ducks lose heat less easily as the barn gets warmer.': 'Nasa 35.0°C ang kulungan; mas nahihirapang maglabas ng init ang itik habang umiinit ito.',
        'Humidity is 70%; higher humidity reduces cooling through panting.': 'Nasa 70% ang halumigmig; mas mataas na halumigmig, mas hirap lumamig sa paghingal.',
        'Surface temperature reached 40.0°C while the barn is at 35.0°C, so ducks are struggling to shed heat.': 'Umabot sa 40.0°C ang temperatura ng itik habang nasa 35.0°C ang kulungan, kaya hirap maglabas ng init ang mga itik.',
        // Summary lines in the result modal: each °C / % value is bolded (its own
        // element), so the text between the values is translated piece by piece:
        // "Surface temperature reached [40°C] while the barn is at [35°C], so …"
        // → "Umabot sa [40°C] ang temperatura ng itik habang nasa [35°C] ang kulungan, kaya …"
        'while the barn is at': 'ang temperatura ng itik habang nasa',
        ', so ducks are struggling to shed heat.': ' ang kulungan, kaya hirap maglabas ng init ang mga itik.',
        ', which is still manageable.': ' ang kulungan, na kaya pang kontrolin.',
        'The barn is at': 'Nasa',
        '; ducks lose heat less easily as the barn gets warmer.': ' ang kulungan; mas nahihirapang maglabas ng init ang itik habang umiinit ito.',
        'Humidity is': 'Nasa',
        '; higher humidity reduces cooling through panting.': ' ang halumigmig; mas mataas na halumigmig, mas hirap lumamig sa paghingal.',
        'Surface temperature reached': 'Umabot sa',
        'which is still manageable.': 'na kaya pang kontrolin.',
        'so ducks are struggling to shed heat.': 'kaya hirap maglabas ng init ang mga itik.',
        'No air reading during this period: the DHT22 was not responding, and the thermal camera could not stand in (it needs a DHT22 humidity from the past 60 minutes and a live thermal image). So there is no urgency level: only the heat-stress status is shown.': 'Walang sukat ng hangin sa panahong ito: hindi tumutugon ang DHT22 at hindi ito mapalitan ng thermal camera (kailangan nito ng halumigmig mula sa DHT22 sa nakaraang 60 minuto at live na thermal image). Kaya walang antas ng urgency; katayuan ng heat stress lang ang ipinapakita.',
        'Air temperature from the thermal camera (DHT22 not responding), with the last DHT22 humidity from the past 60 minutes.': 'Temperatura ng hangin mula sa thermal camera (hindi tumutugon ang DHT22), kasama ang huling halumigmig ng DHT22 sa nakaraang 60 minuto.',

        // Messages
        'Could not load your profile. Please try again.': 'Hindi ma-load ang profile mo. Subukan muli.',
        'We could not load your profile. Please try again.': 'Hindi ma-load ang profile mo. Subukan muli.',
        'Invalid username or password.': 'Mali ang username o password.',
        'Incorrect password': 'Mali ang password',
        'Invalid email address': 'Hindi wastong email address',
        'Something went wrong. Please try again.': 'Nagkaproblema. Subukan muli.',
        'Something went wrong. Please check your connection and try again.': 'Nagkaproblema. Suriin ang koneksyon at subukan muli.',
        'Please request a new reset link before changing your password.': 'Humiling muna ng bagong reset link bago palitan ang password.',
        'Password updated. Please sign in with your new password.': 'Na-update ang password. Mag-log in gamit ang bagong password.',
        'If an account exists for that email, a reset link is on its way.': 'Kung may account ang email na iyon, padating na ang reset link.',
        'Please enter your username and password.': 'Ilagay ang username at password.',
        'Password reset link sent to': 'Naipadala ang reset link sa',
        'Please confirm your email address first, then sign in.': 'Kumpirmahin muna ang email mo bago mag-log in.',
        'Email not confirmed': 'Hindi pa kumpirmado ang email',
        'Your account request was not approved. Contact the administrator for details.': 'Hindi naaprubahan ang account request mo. Makipag-ugnayan sa admin para sa detalye.',
        'Your account is awaiting admin approval.': 'Naghihintay ng pag-apruba ng admin ang account mo.',
        'Account created! Please wait for an admin to approve your account before signing in.': 'Nagawa na ang account! Hintaying aprubahan ito ng admin bago mag-log in.',
        'That username is already taken.': 'May gumagamit na ng username na iyan.',
        'Your current password is incorrect.': 'Mali ang kasalukuyang password mo.',
        'Device ID or API key is incorrect.': 'Mali ang Device ID o API key.',
        'Could not link the device. Check the Device ID and API key, or the device may already be linked.': 'Hindi ma-link ang device. Suriin ang Device ID at API key; baka naka-link na ito.',
        'Password must be 8-16 characters with at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character (no spaces).': 'Dapat 8–16 karakter ang password, may kahit 1 malaking titik, 1 maliit na titik, 1 numero at 1 simbolo (walang espasyo).',
        'Could not load the device registry. Run admin_devices.sql in Supabase.': 'Hindi ma-load ang rehistro ng device. Patakbuhin ang admin_devices.sql sa Supabase.',
        'Could not copy the Device ID.': 'Hindi makopya ang Device ID.',
        'A device with that ID is already registered.': 'May rehistradong device na sa ID na iyan.',
        'Could not delete the device.': 'Hindi mabura ang device.',
        'Could not restore the device.': 'Hindi maibalik ang device.',
        'Could not load user accounts. Add the profiles.status column if it is missing.': 'Hindi ma-load ang mga user account. Idagdag ang profiles.status column kung wala pa.',
        'Account approved.': 'Naaprubahan ang account.',
        'Could not approve the account.': 'Hindi maaprubahan ang account.',
        'Could not reject the request.': 'Hindi matanggihan ang request.',
        'Request rejected.': 'Tinanggihan ang request.',
        'This user has no email address on file.': 'Walang email address ang user na ito.',
        'Too many emails sent. Please wait a while and try again.': 'Masyadong maraming email ang naipadala. Maghintay muna at subukan muli.',
        'Could not delete the user.': 'Hindi mabura ang user.',
        'User deleted.': 'Nabura ang user.',
        'User updated successfully.': 'Na-update ang user.',
        'Could not update the user.': 'Hindi ma-update ang user.',
        'Could not send the reset email: ': 'Hindi maipadala ang reset email: ',
    };

    const dynamicTranslations = [
        [/^Showing (\d+) of (\d+) records$/, (_, shown, total) => `Ipinapakita ang ${shown} sa ${total} tala`],
        [/^Showing (\d+) of (\d+) requests$/, (_, shown, total) => `Ipinapakita ang ${shown} sa ${total} request`],
        [/^Showing (\d+) of (\d+) users$/, (_, shown, total) => `Ipinapakita ang ${shown} sa ${total} user`],
        [/^Password reset link sent to (.+)\.$/, (_, email) => `Naipadala ang reset link sa ${email}.`],
        [/^(.+) registered\.$/, (_, device) => `Nairehistro ang ${device}.`],
        [/^(.+) copied\.$/, (_, value) => `Nakopya ang ${value}.`],
        [/^(.+) moved to the trash\.$/, (_, value) => `Inilipat sa basurahan ang ${value}.`],
        [/^(.+) restored\.$/, (_, value) => `Naibalik ang ${value}.`],
        [/^(.+) deleted permanently\.$/, (_, value) => `Permanenteng nabura ang ${value}.`],
        [/^(.+) updated\.$/, (_, value) => `Na-update ang ${value}.`],
        [/^Sort order: (.+)$/, (_, direction) => `Pagkakasunod-sunod: ${direction}`],
        [/^(\d+) ducks?$/, (_, count) => `${count} itik`],
        [/^(.+?°C) • (\d+) ducks? • (.+)$/, (_, temperature, count, level) => `${temperature} • ${count} itik • ${translated(level)}`],
        [/^(.+?°C) • (\d+) ducks?$/, (_, temperature, count) => `${temperature} • ${count} itik`],
        [/^Choose a period \((.+)\)$/, (_, period) => `Pumili ng petsa (${translated(period)})`],
        [/^Period: (.+)$/, (_, period) => `Petsa: ${translated(period)}`],
        [/^(\d+) of (\d+)$/, (_, current, total) => `${current} sa ${total}`],
        [/^Urgency: (.+)\. Open the details for the full detection results\.$/, (_, level) => `Urgency: ${translated(level)}. Buksan ang detalye para sa buong resulta.`],
        // Camera monitor chips (RGB / Thermal)
        [/^Ducks: (\S+) \((\d+) not measured\)$/, (_, count, missing) => `Itik: ${count} (${missing} hindi nasukat)`],
        [/^Ducks: (\S+)$/, (_, count) => `Itik: ${count}`],
        [/^(Thermal Comfort|Mild Heat Stress|Moderate Heat Stress|Severe Heat Stress): (\S+)$/, (_, status, count) => `${translated(status)}: ${count}`],
        [/^Hottest: (\S+)$/, (_, value) => `Pinakamainit: ${value}`],
        // Result cards: status title, temperatures and confidence
        [/^(Mild|Moderate|Severe) Heat Stress Detected$/, (_, level) => `May ${translated(`${level} Heat Stress`)}`],
        [/^Surface Temp (-?[\d.]+°C|--|\.\.\.)$/, (_, value) => `Temperatura ng Itik ${value}`],
        [/^Ambient Temp (-?[\d.]+°C|--|\.\.\.)$/, (_, value) => `Temperatura ng Paligid ${value}`],
        [/^Confidence (\d+)%$/, (_, value) => `Kumpiyansa ${value}%`],
        // Date picker labels
        [/^Months of (\d+)$/, (_, year) => `Mga buwan ng ${year}`],
        [/^(\d+), choose a year$/, (_, year) => `${year}, pumili ng taon`],
        [/^(.+), choose a month or year$/, (_, month) => `${month}, pumili ng buwan o taon`],
        [/^From (.+)$/, (_, date) => `Mula ${date}`],
        [/^Until (.+)$/, (_, date) => `Hanggang ${date}`],
        [/^(\d+)m ago$/, (_, count) => `${count} min ang nakalipas`],
        [/^(\d+)h ago$/, (_, count) => `${count} oras ang nakalipas`],
        [/^Member since (.+)$/, (_, date) => `Miyembro mula ${date}`],
        [/^Admin since (.+)$/, (_, date) => `Admin mula ${date}`],
        [/^Updated (.+)$/, (_, time) => `Na-update noong ${time}`],
        [/^Up from (.+)$/, (_, level) => `Tumaas mula ${translated(level)}`],
        [/^Down from (.+)$/, (_, level) => `Bumaba mula ${translated(level)}`],
        [/^Previous reading (.+)$/, (_, time) => `Naunang sukat ${time}`],
        [/^Only the first ([\d,]+) readings of this period are shown\. Run environment_trend\.sql in Supabase to chart the whole period\.$/, (_, count) => `Unang ${count} sukat lang ang ipinapakita. Patakbuhin ang environment_trend.sql sa Supabase para makita ang buong petsa.`],
        [/^Surface temperature reached (.+) while the barn is at (.+), (.+)$/, (_, surface, barn, ending) => `Umabot sa ${surface} ang temperatura ng itik habang nasa ${barn} ang kulungan, ${translated(ending)}`],
        [/^(\d+) of (\d+) ducks show signs of heat stress(?:, including (\d+) with Severe Heat Stress)?\.?$/, (_, affected, total, severe) => `May senyales ng heat stress ang ${affected} sa ${total} itik${severe ? `, kabilang ang ${severe} na may Matinding Heat Stress` : ''}.`],
        [/^The barn is at (.+); ducks lose heat less easily as the barn gets warmer\.$/, (_, temp) => `Nasa ${temp} ang kulungan; mas nahihirapang maglabas ng init ang itik habang umiinit ito.`],
        [/^Humidity is (.+); higher humidity reduces cooling through panting\.$/, (_, humidity) => `Nasa ${humidity} ang halumigmig; mas mataas na halumigmig, mas hirap lumamig sa paghingal.`],
        [/^No air \(temperature and humidity\) reading during this period, so there is no urgency level; follow the (.+) status\.$/, (_, status) => `Walang sukat ng hangin (temperatura at halumigmig) sa panahong ito kaya walang antas ng urgency; sundin ang katayuang ${translated(status)}.`],
    ];

    const languageNames = { en: 'English', fil: 'Filipino' };
    const textSources = new WeakMap();
    const attributeSources = new WeakMap();
    let language = 'en';
    let titleSource = document.title;
    let renderedTitle = '';

    function translated(value) {
        const key = value.trim();
        if (language !== 'fil') return value;
        let result = translations[key];
        if (!result) {
            for (const [pattern, format] of dynamicTranslations) {
                const match = key.match(pattern);
                if (match) {
                    result = format(...match);
                    break;
                }
            }
        }
        if (!result) return value;
        const start = value.indexOf(key);
        return start < 0 ? result : value.slice(0, start) + result + value.slice(start + key.length);
    }

    function renderText(node) {
        const value = node.nodeValue;
        let state = textSources.get(node);
        if (!state || value !== state.rendered) {
            state = { source: value, rendered: '' };
        }
        const nextValue = translated(state.source);
        state.rendered = nextValue;
        textSources.set(node, state);
        if (value !== nextValue) node.nodeValue = nextValue;
    }

    // data-offline-text: the camera status shown over each monitor (CSS attr()).
    // The feed <img> keeps its own English copy that livefeed.js compares against,
    // so only the visible one on the monitor container is translated.
    const translatedAttributes = ['aria-label', 'alt', 'data-tooltip', 'placeholder', 'title', 'data-offline-text'];
    function renderAttributes(element) {
        const sources = attributeSources.get(element) || {};
        translatedAttributes.forEach((name) => {
            if (!element.hasAttribute(name)) return;
            if (name === 'data-offline-text' && element.tagName === 'IMG') return;
            const value = element.getAttribute(name);
            if (!sources[name] || value !== sources[name].rendered) {
                sources[name] = { source: value, rendered: '' };
            }
            const nextValue = translated(sources[name].source);
            sources[name].rendered = nextValue;
            if (value !== nextValue) element.setAttribute(name, nextValue);
        });
        attributeSources.set(element, sources);
    }

    function processNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            if (node.parentElement && !node.parentElement.closest('script,style,noscript,svg')) renderText(node);
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const element = node;
        if (element.matches('script,style,noscript,svg')) return;
        renderAttributes(element);
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
            acceptNode(textNode) {
                return textNode.parentElement?.closest('script,style,noscript,svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
            },
        });
        let textNode;
        while ((textNode = walker.nextNode())) renderText(textNode);
        element.querySelectorAll('*').forEach(renderAttributes);
    }

    function updateLanguageButtons() {
        document.querySelectorAll('[data-language-option]').forEach((button) => {
            const isSelected = button.dataset.languageOption === language;
            button.classList.toggle('is-active', isSelected);
            button.setAttribute('aria-pressed', String(isSelected));
        });
    }

    function renderTitle() {
        if (document.title !== renderedTitle) titleSource = document.title;
        renderedTitle = translated(titleSource);
        if (document.title !== renderedTitle) document.title = renderedTitle;
    }

    function applyLanguage() {
        document.documentElement.lang = language;
        processNode(document.body);
        renderTitle();
        updateLanguageButtons();
    }

    function setLanguage(nextLanguage) {
        language = nextLanguage === 'fil' ? 'fil' : 'en';
        try {
            localStorage.setItem(STORAGE_KEY, language);
        } catch (error) {
            console.warn('HeatTrack: could not save the language preference in this browser.', error);
        }
        applyLanguage();
        document.dispatchEvent(new CustomEvent('heattrack:languagechange', { detail: { language } }));
    }

    try {
        const savedLanguage = localStorage.getItem(STORAGE_KEY);
        if (savedLanguage === 'fil') language = 'fil';
    } catch (error) {
        console.warn('HeatTrack: could not read the saved language preference from this browser.', error);
    }

    document.addEventListener('click', (event) => {
        const button = event.target.closest('[data-language-option]');
        if (button) setLanguage(button.dataset.languageOption);
    }, true);

    applyLanguage();

    const observer = new MutationObserver((records) => {
        records.forEach((record) => {
            if (record.type === 'characterData') {
                renderText(record.target);
                return;
            }
            if (record.type === 'attributes') {
                renderAttributes(record.target);
                return;
            }
            record.addedNodes.forEach(processNode);
        });
        if (document.title !== renderedTitle) renderTitle();
        updateLanguageButtons();
    });
    observer.observe(document.body, {
        attributes: true,
        attributeFilter: translatedAttributes,
        characterData: true,
        childList: true,
        subtree: true,
    });
    observer.observe(document.head, { childList: true, characterData: true, subtree: true });

    window.HeatTrackI18n = {
        getLanguage: () => language,
        languageNames,
        setLanguage,
        translate: (value) => translated(String(value)),
    };
})();
