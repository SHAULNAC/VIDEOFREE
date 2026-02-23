const SB_URL = 'https://fbzewdfubjfhqvlusyrj.supabase.co';
const SB_KEY = 'sb_publishable_2JftgVsArBG2NB-RXp0q4Q_jdd8VfPO';
const client = supabase.createClient(SB_URL, SB_KEY);

let currentUser = null;
let debounceTimeout = null;

async function init() {
    const { data: { user } } = await client.auth.getUser();
    currentUser = user;
    updateUserUI();
    fetchVideos();
    if (user) loadSidebarLists();
}

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

async function getTranslation(text) {
    const cleanText = text.trim().toLowerCase();
    const { data: cacheEntry } = await client.from('translation_cache').select('translated_text').eq('original_text', cleanText).maybeSingle();
    if (cacheEntry) return cacheEntry.translated_text;

    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=iw&tl=en&dt=t&q=${encodeURI(cleanText)}`);
        const data = await res.json();
        const translated = data[0][0][0];
        if (translated && translated.toLowerCase() !== cleanText) {
            await client.from('translation_cache').insert([{ original_text: cleanText, translated_text: translated.toLowerCase() }]);
            return translated;
        }
    } catch (e) { console.error("Translation error:", e); }
    return null;
}

async function fetchVideos(query = "") {
    const searchQuery = query.trim();
    if (!searchQuery) {
        const { data } = await client.from('videos').select('*').order('published_at', { ascending: false });
        renderVideoGrid(data);
        return;
    }

    // שלב 1: חפש קודם כל את מה שהמשתמש הקליד (עברית/מקור)
    await executeSearch(searchQuery);

    // שלב 2: תרגם וחפש גם את האנגלית, אבל אל תשרשר אותם למחרוזת אחת
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(async () => {
        const translated = await getTranslation(searchQuery);
        if (translated && translated.toLowerCase() !== searchQuery.toLowerCase()) {
            console.log("מבצע חיפוש נוסף עבור התרגום:", translated);
            
            const { data: translatedData } = await client.rpc('search_videos_prioritized', {
                search_term: translated
            });

            if (translatedData && translatedData.length > 0) {
                // הוספת התוצאות מהתרגום לתוצאות הקיימות (מניעת כפילויות)
                renderVideoGrid(translatedData, true); 
            }
        }
    }, 800);
}

async function executeSearch(finalQuery) {
    // מנקים רווחים כפולים ומוודאים שהמחרוזת לא ריקה
    const cleanQuery = finalQuery.trim();
    if (!cleanQuery) return;

    console.log("מבצע חיפוש עבור:", cleanQuery); // לבדיקה בקונסול

    const { data, error } = await client.rpc('search_videos_prioritized', {
        search_term: cleanQuery
    });

    if (error) {
        console.error("Search error:", error.message);
        return;
    }

    renderVideoGrid(data);
}

let currentDisplayedVideos = [];

function renderVideoGrid(data, isAppend = false) {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;

    if (!isAppend) {
        currentDisplayedVideos = data || [];
    } else {
        // מיזוג תוצאות חדשות ושמירה על ייחודיות לפי ID
        const existingIds = new Set(currentDisplayedVideos.map(v => v.id));
        const newUniqueVideos = data.filter(v => !existingIds.has(v.id));
        currentDisplayedVideos = [...currentDisplayedVideos, ...newUniqueVideos];
    }

    if (currentDisplayedVideos.length === 0) {
        grid.innerHTML = '<p style="padding:20px; text-align:center;">לא נמצאו סרטונים...</p>';
        return;
    }

    grid.innerHTML = currentDisplayedVideos.map(v => {
        const safeTitle = (v.title || "").replace(/'/g, "\\'");
        const safeChannel = (v.channel_title || "").replace(/'/g, "\\'");
        return `
            <div class="v-card" onclick="playVideo('${v.id}', '${safeTitle}', '${safeChannel}')">
                <div class="card-img-container">
                    <img src="${v.thumbnail || ''}">
                    <button class="play-overlay-btn"><i class="fa-solid fa-play"></i></button>
                </div>
                <h3>${v.title || ''}</h3>
                <div class="card-footer">
                    <span>${v.channel_title || ''}</span>
                </div>
            </div>`;
    }).join('');
}

async function playVideo(id, title, channel) {
    const player = document.getElementById('youtubePlayer');
    if (player) {
        player.src = `https://www.youtube.com/embed/${id}?autoplay=1`;
        document.getElementById('current-title').innerText = title;
        document.getElementById('current-channel').innerText = channel;
    }
}

async function loadSidebarLists() {
    if (!currentUser) return;
    const { data: history } = await client.from('history').select('videos(id, title)').eq('user_id', currentUser.id).limit(5);
    const sidebarList = document.getElementById('favorites-list');
    if (history && sidebarList) {
        sidebarList.innerHTML = history.map(h => h.videos ? `
            <div class="nav-link" onclick="playVideo('${h.videos.id}', '${h.videos.title.replace(/'/g, "\\'")}', '')">
                <i class="fa-solid fa-clock-rotate-left"></i> ${h.videos.title}
            </div>` : '').join('');
    }
}

document.getElementById('globalSearch').addEventListener('input', (e) => fetchVideos(e.target.value));
init();
