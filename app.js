const SB_URL = 'https://fbzewdfubjfhqvlusyrj.supabase.co';
const SB_KEY = 'sb_publishable_2JftgVsArBG2NB-RXp0q4Q_jdd8VfPO';
const client = supabase.createClient(SB_URL, SB_KEY);

let currentUser = null;
let debounceTimeout = null;

// --- אתחול המערכת ---
async function init() {
    const { data: { user } } = await client.auth.getUser();
    currentUser = user;
    updateUserUI();
    fetchVideos();
    if (user) {
        loadSidebarLists();
    }
}

// --- ניהול משתמש ---
function updateUserUI() {
    const userDiv = document.getElementById('user-profile');
    if (currentUser && userDiv) {
        userDiv.innerHTML = `
            <img src="${currentUser.user_metadata.avatar_url}" style="width:35px; border-radius:50%; border: 2px solid #1DB954;">
            <div style="display:flex; flex-direction:column;">
                <span style="font-size:14px; font-weight:bold;">${currentUser.user_metadata.full_name}</span>
                <span onclick="logout()" style="color:#b3b3b3; font-size:11px; cursor:pointer; text-decoration:underline;">התנתק</span>
            </div>
        `;
    }
}

// --- מנגנון תרגום וחיפוש חכם ---
async function getTranslation(text) {
    const cleanText = text.trim().toLowerCase();
    
    // בדיקה ב-Cache לפי שמות העמודות שלך
    const { data: cacheEntry } = await client
        .from('translation_cache')
        .select('translated_text')
        .eq('original_text', cleanText)
        .maybeSingle();

    if (cacheEntry) return cacheEntry.translated_text;

    // תרגום חיצוני
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=iw&tl=en&dt=t&q=${encodeURI(cleanText)}`);
        const data = await res.json();
        const translated = data[0][0][0];

        if (translated && translated.toLowerCase() !== cleanText) {
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
    
    if (!searchQuery) {
        const { data } = await client.from('videos').select('*').order('added_at', { ascending: false });
        renderVideoGrid(data);
        return;
    }

    // חיפוש מהיר בעברית
    executeSearch(searchQuery);

    // המתנה לתרגום וחיפוש משולב
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(async () => {
        const translated = await getTranslation(searchQuery);
        if (translated) {
            executeSearch(`${searchQuery} | ${translated}`);
        }
    }, 800);
}

async function executeSearch(finalQuery) {
    try {
        // אנחנו מבצעים חיפוש שסורק את כל העמודות שביקשת
        // העמודה fts_doc אמורה להכיל את האינדקס של כל השדות האלו ב-Supabase
        const { data, error } = await client
            .from('videos')
            .select('*')
            .or(`title.fts.${finalQuery},description.fts.${finalQuery},categories.fts.${finalQuery},tags.fts.${finalQuery}`)
            .order('added_at', { ascending: false });

        if (error) throw error;
        renderVideoGrid(data);
    } catch (error) {
        console.error("Search execution error:", error);
        
        // במידה ויש בעיה בחיפוש ה-fts המשולב, נבצע חיפוש רחב עם ilike
        // שיבדוק לפחות את הכותרת והתיאור
        const cleanQuery = finalQuery.split('|')[0].trim();
        const { data: fallbackData } = await client
            .from('videos')
            .select('*')
            .or(`title.ilike.%${cleanQuery}%,description.ilike.%${cleanQuery}%`)
            .limit(20);
        
        if (fallbackData) renderVideoGrid(fallbackData);
    }
}
function renderVideoGrid(data) {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;
    
    if (!data || data.length === 0) {
        grid.innerHTML = '<p style="padding:20px; text-align:center;">לא נמצאו סרטונים...</p>';
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

// --- נגן והיסטוריה ---
async function playVideo(id, title, channel) {
    document.getElementById('youtubePlayer').src = `https://www.youtube.com/embed/${id}?autoplay=1`;
    document.getElementById('current-title').innerText = title;
    document.getElementById('current-channel').innerText = channel;

    if (currentUser) {
        await client.from('history').insert({ user_id: currentUser.id, video_id: id });
        loadSidebarLists();
    }
}

// --- פונקציות צד ---
async function loadSidebarLists() {
    if (!currentUser) return;
    const { data: history } = await client
        .from('history')
        .select('videos(id, title)')
        .eq('user_id', currentUser.id)
        .order('watched_at', { ascending: false })
        .limit(5);

    const sidebarList = document.getElementById('favorites-list');
    if (history && sidebarList) {
        sidebarList.innerHTML = '<p style="font-size:12px; color:#b3b3b3; margin-bottom:10px;">צפיות אחרונות</p>' + 
        history.map(h => `
            <div class="nav-link" style="font-size:13px; padding:5px 0;" onclick="playVideo('${h.videos.id}', '${h.videos.title}', '')">
                <i class="fa-solid fa-clock-rotate-left" style="font-size:12px;"></i> ${h.videos.title}
            </div>
        `).join('');
    }
}

async function login() { await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } }); }
async function logout() { await client.auth.signOut(); window.location.reload(); }

// מאזין אירועים - כאן היה חסר ה-")" שגרם לשגיאה
document.getElementById('globalSearch').addEventListener('input', (e) => {
    fetchVideos(e.target.value);
});

init();
