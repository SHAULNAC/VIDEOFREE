// קונפיגורציה
const SB_URL = 'https://fbzewdfubjfhqvlusyrj.supabase.co';
const SB_KEY = 'sb_publishable_2JftgVsArBG2NB-RXp0q4Q_jdd8VfPO';
const client = supabase.createClient(SB_URL, SB_KEY);

let translationTimer = null;
let currentLocalData = []; 

// --- מנוע תרגום חכם עם עדיפות למאגר שלך ---
async function getSmartTranslation(text) {
    const cleanText = text.trim().toLowerCase();
    
    // בדיקה במאגר המתורגם (Cache) - אם נמצא, הוא לא פונה לגוגל!
    const { data: cacheEntry } = await client
        .from('translation_cache')
        .select('translated_text')
        .eq('original_text', cleanText)
        .single();

    if (cacheEntry) {
        console.log("נמצא במאגר הפנימי, חוסך פנייה לגוגל");
        return cacheEntry.translated_text;
    }

    // רק אם לא נמצא במאגר הפנימי - פונה לתרגום
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=iw&tl=en&dt=t&q=${encodeURI(cleanText)}`);
        const data = await res.json();
        const translated = data[0][0][0];

        if (translated && translated.toLowerCase() !== cleanText) {
            // שומר למאגר כדי שבפעם הבאה זה יהיה מיידי
            await client.from('translation_cache').insert([{ original_text: cleanText, translated_text: translated }]);
            return translated;
        }
    } catch (e) { return null; }
    return null;
}

// --- פונקציית החיפוש ---
async function fetchVideos(query = "", isAppend = false) {
    let request = client.from('videos').select('*');

    if (query) {
        request = request.or(`title.ilike.%${query}%,description.ilike.%${query}%`);
    }

    const { data, error } = await request.order('added_at', { ascending: false });

    if (error) return;

    if (isAppend) {
        const combined = [...currentLocalData, ...data];
        const unique = Array.from(new Map(combined.map(v => [v.id, v])).values());
        renderGrid(unique);
    } else {
        currentLocalData = data;
        renderGrid(data);
    }
}

// --- רינדור הגריד (כאן התיקון הויזואלי) ---
function renderGrid(videos) {
    const container = document.getElementById('videoGrid');
    if (!container) return;
    
    // החזרת המבנה הפשוט והמקורי שלך בלי "עטיפות" מיותרות ששוברות את ה-CSS
    container.innerHTML = videos.map(video => `
        <div class="video-item">
            <a href="https://www.youtube.com/watch?v=${video.video_id || video.youtube_id}" target="_blank">
                <img src="${video.thumbnail || video.thumbnail_url}" alt="${video.title}">
                <div class="video-title">${video.title}</div>
            </a>
        </div>
    `).join('');
}

// --- מאזין חיפוש ---
document.getElementById('globalSearch').addEventListener('input', (e) => {
    const val = e.target.value.trim();
    
    if (!val) {
        fetchVideos(""); 
        return;
    }

    // 1. חיפוש מיידי
    fetchVideos(val, false);

    // 2. תרגום (רק אם עצרנו את ההקלדה)
    clearTimeout(translationTimer);
    if (val.length > 2 && /[\u0590-\u05FF]/.test(val)) {
        translationTimer = setTimeout(async () => {
            const translated = await getSmartTranslation(val);
            if (translated) {
                await fetchVideos(translated, true);
            }
        }, 800);
    }
});

document.addEventListener('DOMContentLoaded', () => fetchVideos(""));
