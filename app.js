// קונפיגורציה
const SB_URL = 'https://fbzewdfubjfhqvlusyrj.supabase.co';
const SB_KEY = 'sb_publishable_2JftgVsArBG2NB-RXp0q4Q_jdd8VfPO';
const client = supabase.createClient(SB_URL, SB_KEY);

let localSearchTimer = null;
let translationTimer = null;
let currentResults = []; // מאגר התוצאות המוצגות כרגע

// --- פונקציות עזר ---

function toggleSpinner(show) {
    const spinner = document.getElementById('searchSpinner');
    if (spinner) spinner.style.display = show ? 'block' : 'none';
}

async function getSmartTranslation(text) {
    const cleanText = text.trim().toLowerCase();
    
    // 1. בדיקה במטמון
    const { data: cacheEntry } = await client
        .from('translation_cache')
        .select('translated_text')
        .eq('original_text', cleanText)
        .single();

    if (cacheEntry) return cacheEntry.translated_text;

    // 2. פנייה לגוגל
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=iw&tl=en&dt=t&q=${encodeURI(cleanText)}`);
        const data = await res.json();
        const translated = data[0][0][0];

        if (translated && translated.toLowerCase() !== cleanText) {
            await client.from('translation_cache').insert([
                { original_text: cleanText, translated_text: translated }
            ]);
            return translated;
        }
    } catch (e) {
        console.error("Translation error:", e);
    }
    return null;
}

// --- פונקציות ליבת החיפוש ---

async function performSearch(query, isTranslation = false) {
    if (!query) return;

    const { data, error } = await client
        .from('videos')
        .select('*')
        .or(`title.ilike.%${query}%,description.ilike.%${query}%,channel_title.ilike.%${query}%`);

    if (error) {
        console.error("Search error:", error);
        return;
    }

    if (isTranslation) {
        const existingIds = new Set(currentResults.map(v => v.id));
        const filteredNewData = data.filter(v => !existingIds.has(v.id));
        currentResults = [...currentResults, ...filteredNewData];
    } else {
        currentResults = data;
    }
    
    renderGrid(currentResults);
}

async function loadAllVideos() {
    toggleSpinner(true);
    const { data, error } = await client
        .from('videos')
        .select('*')
        .order('added_at', { ascending: false });

    if (error) {
        console.error("Error loading videos:", error);
    } else {
        currentResults = data;
        renderGrid(data);
    }
    toggleSpinner(false);
}

// קריאה ראשונית בטעינת הדף
document.addEventListener('DOMContentLoaded', loadAllVideos);

function renderGrid(videos) {
    const container = document.getElementById('videoGrid');
    if (!container) return;
    
    if (!videos || videos.length === 0) {
        container.innerHTML = '<p class="no-results">לא נמצאו סרטונים...</p>';
        return;
    }

    container.innerHTML = videos.map(video => {
        // התאמה למבנה הנתונים שלך
        const imgUrl = video.thumbnail || video.thumbnail_url || 'placeholder.jpg';
        const videoId = video.video_id || video.youtube_id;
        const videoLink = `https://www.youtube.com/watch?v=${videoId}`;
        
        return `
            <div class="video-card">
                <a href="${videoLink}" target="_blank">
                    <div class="thumbnail-container">
                        <img src="${imgUrl}" alt="${video.title}" 
                             onerror="this.src='https://via.placeholder.com/320x180?text=No+Image'">
                    </div>
                    <div class="video-info">
                        <h3>${video.title}</h3>
                        <p class="channel-name">${video.channel_title || ''}</p>
                    </div>
                </a>
            </div>
        `;
    }).join('');
}

// --- מאזין אירועים ---

document.getElementById('globalSearch').addEventListener('input', (e) => {
    const val = e.target.value.trim();
    
    if (!val) {
        loadAllVideos(); // טעינה מחדש של הכל כשמוחקים את החיפוש
        return;
    }

    // 1. חיפוש מקומי מהיר
    clearTimeout(localSearchTimer);
    localSearchTimer = setTimeout(() => {
        performSearch(val, false);
    }, 300);

    // 2. תרגום וחיזוק תוצאות
    clearTimeout(translationTimer);
    translationTimer = setTimeout(async () => {
        if (val.length > 2 && /[\u0590-\u05FF]/.test(val)) {
            toggleSpinner(true);
            const translated = await getSmartTranslation(val);
            if (translated) {
                await performSearch(translated, true);
            }
            toggleSpinner(false);
        }
    }, 900);
});
