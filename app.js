// קונפיגורציה
const SB_URL = 'https://fbzewdfubjfhqvlusyrj.supabase.co';
const SB_KEY = 'sb_publishable_2JftgVsArBG2NB-RXp0q4Q_jdd8VfPO';
const client = supabase.createClient(SB_URL, SB_KEY);

let translationTimer = null;
let currentLocalData = []; 

// --- מנוע תרגום חכם: קודם מאגר פנימי, אחר כך גוגל ---
async function getSmartTranslation(text) {
    const cleanText = text.trim().toLowerCase();
    
    // 1. בדיקה במאגר המתורגם ב-Supabase
    const { data: cacheEntry } = await client
        .from('translation_cache')
        .select('translated_text')
        .eq('original_text', cleanText)
        .single();

    // אם המילה נמצאה במאגר - מחזירים אותה מיד ולא פונים לגוגל
    if (cacheEntry) {
        return cacheEntry.translated_text;
    }

    // 2. רק אם לא נמצא במאגר - פנייה לתרגום חיצוני
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=iw&tl=en&dt=t&q=${encodeURI(cleanText)}`);
        const data = await res.json();
        const translated = data[0][0][0];

        if (translated && translated.toLowerCase() !== cleanText) {
            // שמירה למאגר שלך כדי שבפעם הבאה זה יהיה פנימי ומיידי
            await client.from('translation_cache').insert([{ original_text: cleanText, translated_text: translated }]);
            return translated;
        }
    } catch (e) { return null; }
    return null;
}

let debounceTimeout = null;

async function fetchVideos(query = "") {
    const searchQuery = query.trim();
    if (!searchQuery) {
        // טעינה ראשונית ללא חיפוש
        const { data } = await client.from('videos').select('*').order('added_at', { ascending: false });
        renderVideoGrid(data);
        return;
    }

    // --- שלב א': חיפוש מהיר (מקור + תרגום קיים ב-Cache) ---
    const { data: cacheData } = await client
        .from('translation_cache')
        .select('english_text')
        .eq('hebrew_text', searchQuery.toLowerCase())
        .maybeSingle();

    let existingTranslation = cacheData?.english_text;
    let fastQuery = existingTranslation ? `${searchQuery} | ${existingTranslation}` : searchQuery;
    
    // ביצוע חיפוש ראשוני מהיר
    executeSearch(fastQuery);

    // --- שלב ב': Debounce לתרגום API ושמירה ---
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(async () => {
        // אם אין לנו תרגום ב-Cache, נתרגם עכשיו
        if (!existingTranslation) {
            const newTranslation = await translateText(searchQuery);
            
            if (newTranslation && newTranslation.toLowerCase() !== searchQuery.toLowerCase()) {
                // שמירה ל-Cache
                await client.from('translation_cache').insert({
                    hebrew_text: searchQuery.toLowerCase(),
                    english_text: newTranslation.toLowerCase()
                });
                
                // חיפוש חוזר ומדויק עם התרגום החדש
                executeSearch(`${searchQuery} | ${newTranslation}`);
            }
        }
    }, 800); // 800ms מסיום ההקלדה
}

// פונקציה שמבצעת את השאילתה מול ה-RPC ב-SQL
async function executeSearch(finalQuery) {
    const { data, error } = await client.rpc('search_videos_prioritized', {
        search_term: finalQuery
    });

    if (!error) {
        renderVideoGrid(data);
    } else {
        console.error("Search error:", error);
    }
}

// פונקציית עזר לתרגום גוגל
async function translateText(text) {
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=iw&tl=en&dt=t&q=${encodeURI(text)}`);
        const json = await res.json();
        return json[0][0][0];
    } catch (e) {
        return null;
    }
}

// עדכון ה-EventListener
document.getElementById('globalSearch').addEventListener('input', (e) => {
    fetchVideos(e.target.value);
});// --- כאן תדביק את פונקציית renderGrid המקורית שלך בדיוק כפי שהייתה ---
function renderGrid(videos) {
    const container = document.getElementById('videoGrid');
    if (!container) return;

    // *** תדביק כאן את ה-innerHTML המקורי שלך ***
    // דוגמה למבנה (תחליף במה שיש לך):
    // container.innerHTML = videos.map(video => ` ... `).join('');
}

document.addEventListener('DOMContentLoaded', () => fetchVideos(""));
