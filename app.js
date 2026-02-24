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
    // ניקוי תווים מיוחדים שעלולים לשבור את ה-FTS
    const cleanQuery = finalQuery.replace(/[!@#$%^&*(),.?":{}|<>]/g, '').trim();
    
    if (!cleanQuery) return;

    const { data, error } = await client.rpc('search_videos_prioritized', {
        search_term: cleanQuery
    });

    if (error) {
        console.error("FTS Search Error:", error.message);
        // Fallback פשוט במידה וה-FTS נכשל בגלל סינטקס
        const { data: fallbackData } = await client
            .from('videos')
            .select('*')
            .ilike('title', `%${cleanQuery}%`)
            .limit(10);
        if (fallbackData) renderVideoGrid(fallbackData);
        return;
    }

    renderVideoGrid(data);
}

let currentDisplayedVideos = [];

function renderVideoGrid(data) {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;
    
    if (!data || data.length === 0) {
        grid.innerHTML = '<p style="padding:20px; text-align:center; color: #b3b3b3;">לא נמצאו סרטונים...</p>';
        return;
    }

    grid.innerHTML = data.map(v => {
        // הגנות מפני ערכים ריקים (null)
        const title = v.title || "";
        const channel = v.channel_title || "";
        const description = v.description || "אין תיאור זמין";
        const videoId = v.id || "";

        // ניקוי תווים שעלולים לשבור את הקוד
        const safeTitle = title.replace(/'/g, "\\'");
        const safeChannel = channel.replace(/'/g, "\\'");
        
        return `
            <div class="v-card" onclick="playVideo('${videoId}', '${safeTitle}', '${safeChannel}')">
                <div class="card-img-container">
                    <img src="${v.thumbnail || ''}" loading="lazy">
                    <div class="video-description-overlay">${description}</div>
                    <button class="play-overlay-btn"><i class="fa-solid fa-play"></i></button>
                </div>
                <h3>${title}</h3>
                <div class="card-footer">
                    <span>${channel}</span>
                    <button class="fav-btn" onclick="event.stopPropagation(); toggleFavorite('${videoId}')">
                        <i class="fa-regular fa-heart" id="fav-icon-${videoId}"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// פונקציית המועדפים (תוודא שהיא קיימת בקובץ למטה)
async function toggleFavorite(videoId) {
    if (!currentUser) {
        alert("עליך להתחבר כדי להוסיף למועדפים");
        return;
    }
    const icon = document.getElementById(`fav-icon-${videoId}`);
    try {
        const { data: existing } = await client.from('favorites').select('*').eq('user_id', currentUser.id).eq('video_id', videoId).maybeSingle();
        if (existing) {
            await client.from('favorites').delete().eq('id', existing.id);
            icon.classList.replace('fa-solid', 'fa-regular');
            icon.style.color = 'inherit';
        } else {
            await client.from('favorites').insert([{ user_id: currentUser.id, video_id: videoId }]);
            icon.classList.replace('fa-regular', 'fa-solid');
            icon.style.color = '#1DB954';
        }
    } catch (e) { console.error(e); }
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

    // --- טעינת מועדפים ---
    try {
        const { data: favorites } = await client
            .from('favorites')
            .select('video_id, videos(id, title)')
            .eq('user_id', currentUser.id)
            .limit(10);

        const favListDiv = document.getElementById('favorites-list');
        if (favorites && favListDiv) {
            favListDiv.innerHTML = favorites.map(f => f.videos ? `
                <div class="nav-link sidebar-item" onclick="playVideo('${f.videos.id}', '${f.videos.title.replace(/'/g, "\\'")}', '')">
                    <i class="fa-solid fa-play-circle" style="font-size: 10px;"></i> ${f.videos.title}
                </div>` : '').join('');
        }
    } catch (e) { console.error("Error loading favorites:", e); }

    // --- טעינת היסטוריה ---
    try {
        const { data: history } = await client
            .from('history')
            .select('video_id, videos(id, title)')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(5);

        const historyListDiv = document.getElementById('history-list');
        if (history && historyListDiv) {
            historyListDiv.innerHTML = history.map(h => h.videos ? `
                <div class="nav-link sidebar-item" onclick="playVideo('${h.videos.id}', '${h.videos.title.replace(/'/g, "\\'")}', '')">
                    <i class="fa-solid fa-history" style="font-size: 10px;"></i> ${h.videos.title}
                </div>` : '').join('');
        }
    } catch (e) { console.error("Error loading history:", e); }
}

document.getElementById('globalSearch').addEventListener('input', (e) => fetchVideos(e.target.value));
init();
