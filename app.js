// קונפיגורציה
const SB_URL = 'https://fbzewdfubjfhqvlusyrj.supabase.co';
const SB_KEY = 'sb_publishable_2JftgVsArBG2NB-RXp0q4Q_jdd8VfPO';
const client = supabase.createClient(SB_URL, SB_KEY);

let debounceTimeout = null;

// פונקציה חכמה לתרגום - מותאמת לשמות העמודות שלך
async function getTranslation(text) {
    const cleanText = text.trim().toLowerCase();
    
    // 1. בדיקה ב-Cache (לפי השמות שציינת: original_text)
    const { data: cacheEntry, error } = await client
        .from('translation_cache')
        .select('translated_text')
        .eq('original_text', cleanText)
        .maybeSingle();

    if (cacheEntry) return cacheEntry.translated_text;

    // 2. תרגום חיצוני במידה ולא נמצא
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=iw&tl=en&dt=t&q=${encodeURI(cleanText)}`);
        const data = await res.json();
        const translated = data[0][0][0];

        if (translated && translated.toLowerCase() !== cleanText) {
            // שמירה ל-Cache (לפי השמות שציינת: original_text, translated_text)
            await client.from('translation_cache').insert([{ 
                original_text: cleanText, 
                translated_text: translated.toLowerCase() 
            }]);
            return translated;
        }
    } catch (e) { console.error("Translation error:", e); }
    return null;
}

async function fetchVideos(query = "") {
    const searchQuery = query.trim();
    
    // אם החיפוש ריק - הצג הכל מסודר לפי תאריך הוספה
    if (!searchQuery) {
        const { data } = await client.from('videos').select('*').order('added_at', { ascending: false });
        renderVideoGrid(data);
        return;
    }

    // שלב א': חיפוש מהיר מיידי על המילה המקורית
    executeSearch(searchQuery);

    // שלב ב': המתנה של 800ms, תרגום וחיפוש משולב
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(async () => {
        const translated = await getTranslation(searchQuery);
        if (translated) {
            // חיפוש ב-Database שכולל גם את המקור וגם את התרגום
            executeSearch(`${searchQuery} | ${translated}`);
        }
    }, 800);
}

// פונקציית ביצוע החיפוש מול ה-RPC (הפונקציה ב-SQL)
async function executeSearch(finalQuery) {
    const { data, error } = await client.rpc('search_videos_prioritized', {
        search_term: finalQuery
    });
    if (!error) renderVideoGrid(data);
    else console.error("Search execution error:", error);
}

// פונקציית הרינדור - בונה את כרטיסי הסרטונים
function renderVideoGrid(data) {
    const grid = document.getElementById('videoGrid');
    if (!data || data.length === 0) {
        grid.innerHTML = '<p style="padding:20px; text-align:center; color:#b3b3b3;">לא נמצאו תוצאות לחיפוש זה...</p>';
        return;
    }
    grid.innerHTML = data.map(v => `
        <div class="v-card" onclick="playVideo('${v.id}', '${v.title}', '${v.channel_title}')">
            <div class="card-img-container">
                <img src="${v.thumbnail}">
                <button class="play-overlay-btn"><i class="fa-solid fa-play"></i></button>
            </div>
            <h3>${v.title}</h3>
            <div class="card-footer">
                <span>${v.channel_title}</span>
                <i class="fa-regular fa-heart" onclick="event.stopPropagation(); toggleFavorite('${v.id}')" id="fav-icon-${v.id}"></i>
            </div>
        </div>
    `).join('');
}

// מאזין לאירוע הקלדה בחיפוש
document.getElementById('globalSearch').addEventListener('input', (e) => fetchVideos(e.target.value));

// טעינה ראשונית של הדף
document.addEventListener('DOMContentLoaded', () => fetchVideos(""));
