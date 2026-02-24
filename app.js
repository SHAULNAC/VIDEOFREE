const SB_URL = 'https://fbzewdfubjfhqvlusyrj.supabase.co';
const SB_KEY = 'sb_publishable_2JftgVsArBG2NB-RXp0q4Q_jdd8VfPO';
const client = supabase.createClient(SB_URL, SB_KEY);

let currentUser = null;
let userFavorites = []; // מחזיק את רשימת ה-IDs של המועדפים
let debounceTimeout = null;

async function init() {
    const { data: { user } } = await client.auth.getUser();
    currentUser = user;
    updateUserUI();
    
    if (user) {
        // טעינת רשימת ה-IDs של המועדפים מראש כדי לצבוע לבבות
        const { data: favs } = await client.from('favorites').select('video_id').eq('user_id', user.id);
        userFavorites = favs ? favs.map(f => f.video_id) : [];
        loadSidebarLists();
    }
    
    fetchVideos();
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

async function login() { await client.auth.signInWithOAuth({ provider: 'google' }); }
async function logout() { await client.auth.signOut(); window.location.reload(); }

async function fetchVideos(query = "") {
    const searchQuery = query.trim();
    if (!searchQuery) {
        const { data } = await client.from('videos').select('*').order('published_at', { ascending: false });
        renderVideoGrid(data);
        return;
    }
    executeSearch(searchQuery);
}

async function executeSearch(finalQuery) {
    const { data, error } = await client.rpc('search_videos_prioritized', { search_term: finalQuery });
    renderVideoGrid(data || []);
}

function renderVideoGrid(data) {
    const grid = document.getElementById('videoGrid');
    if (!grid || !data) return;
    
    grid.innerHTML = data.map(v => {
        const title = v.title || "";
        const channel = v.channel_title || "";
        const videoId = v.id || "";

        // ניקוי אגרסיבי למניעת SyntaxError (השגיאה שראית בקונסול)
        const safeTitle = title.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ');
        const safeChannel = channel.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ');
        
        // בדיקה האם הסרטון במועדפים כדי לצבוע את הלב
        const isFav = userFavorites.includes(videoId);
        const heartClass = isFav ? 'fa-solid' : 'fa-regular';
        const heartStyle = isFav ? 'style="color: #1DB954;"' : '';

        return `
            <div class="v-card" onclick="playVideo('${videoId}', '${safeTitle}', '${safeChannel}')">
                <div class="card-img-container">
                    <img src="${v.thumbnail || ''}" loading="lazy">
                    <div class="video-description-overlay">${(v.description || "").replace(/'/g, "\\'")}</div>
                    <button class="play-overlay-btn"><i class="fa-solid fa-play"></i></button>
                </div>
                <h3>${title}</h3>
                <div class="card-footer">
                    <span>${channel}</span>
                    <button class="fav-btn" onclick="event.stopPropagation(); toggleFavorite('${videoId}')">
                        <i class="${heartClass} fa-heart" id="fav-icon-${videoId}" ${heartStyle}></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function playVideo(id, title, channel) {
    const player = document.getElementById('youtubePlayer');
    if (!player) return;

    player.src = `https://www.youtube.com/embed/${id}?autoplay=1`;
    document.getElementById('current-title').innerText = title;
    document.getElementById('current-channel').innerText = channel;

    if (currentUser) {
        await client.from('history').upsert({ 
            user_id: currentUser.id, 
            video_id: id,
            created_at: new Date().toISOString() 
        }, { onConflict: 'user_id, video_id' });
        loadSidebarLists();
    }
}

async function toggleFavorite(videoId) {
    if (!currentUser) return alert("עליך להתחבר כדי להוסיף למועדפים");
    const icon = document.getElementById(`fav-icon-${videoId}`);
    
    try {
        const isCurrentlyFav = userFavorites.includes(videoId);

        if (isCurrentlyFav) {
            await client.from('favorites').delete().eq('user_id', currentUser.id).eq('video_id', videoId);
            userFavorites = userFavorites.filter(id => id !== videoId);
            if (icon) { icon.classList.replace('fa-solid', 'fa-regular'); icon.style.color = 'inherit'; }
        } else {
            await client.from('favorites').insert([{ user_id: currentUser.id, video_id: videoId }]);
            userFavorites.push(videoId);
            if (icon) { icon.classList.replace('fa-regular', 'fa-solid'); icon.style.color = '#1DB954'; }
        }
        loadSidebarLists();
    } catch (e) { console.error(e); }
}

async function loadSidebarLists() {
    if (!currentUser) return;

    // מועדפים עם כפתור הסרה (X)
    const { data: favs } = await client.from('favorites').select('video_id, videos(id, title)').eq('user_id', currentUser.id);
    const favList = document.getElementById('favorites-list');
    if (favs && favList) {
        favList.innerHTML = favs.map(f => f.videos ? `
            <div class="nav-link sidebar-item" style="display:flex; justify-content:space-between; align-items:center;">
                <div onclick="playVideo('${f.videos.id}', '${f.videos.title.replace(/'/g, "\\'")}', '')" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer;">
                    <i class="fa-solid fa-heart" style="color:#1DB954; font-size:10px;"></i> ${f.videos.title}
                </div>
                <i class="fa-solid fa-xmark" onclick="event.stopPropagation(); toggleFavorite('${f.videos.id}')" style="cursor:pointer; padding:0 5px; opacity:0.6;"></i>
            </div>` : '').join('');
    }

    // היסטוריה
    const { data: hist } = await client.from('history').select('video_id, videos(id, title)').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(8);
    const histList = document.getElementById('history-list');
    if (hist && histList) {
        histList.innerHTML = hist.map(h => h.videos ? `
            <div class="nav-link sidebar-item" onclick="playVideo('${h.videos.id}', '${h.videos.title.replace(/'/g, "\\'")}', '')" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                <i class="fa-solid fa-clock-rotate-left" style="font-size:10px;"></i> ${h.videos.title}
            </div>` : '').join('');
    }
}
// פונקציית גרירה (Drag)
const player = document.getElementById('floating-player');
const handle = document.getElementById('drag-handle');

handle.onmousedown = function(e) {
    let shiftX = e.clientX - player.getBoundingClientRect().left;
    let shiftY = e.clientY - player.getBoundingClientRect().top;

    function moveAt(pageX, pageY) {
        player.style.left = pageX - shiftX + 'px';
        player.style.top = pageY - shiftY + 'px';
        player.style.bottom = 'auto'; // מבטל הצמדה לתחתית
    }

    function onMouseMove(event) { moveAt(event.pageX, event.pageY); }
    document.addEventListener('mousemove', onMouseMove);
    document.onmouseup = () => { document.removeEventListener('mousemove', onMouseMove); };
};

// האזנה למקלדת
document.addEventListener('keydown', (e) => {
    if (e.code === "Space") { // רווח להפסקה/הפעלה
        e.preventDefault();
        togglePlay();
    }
});

function togglePlay() {
    const iframe = document.getElementById('youtubePlayer');
    const icon = document.getElementById('play-pause-icon');
    // ביוטיוב iframe שליטה בנגן דורשת את ה-API של יוטיוב, 
    // אבל פתרון פשוט הוא "לרענן" את ה-src או להשתמש ב-postMessage.
    alert("שליטה מלאה ב-Play/Pause דורשת את YouTube IFrame API");
}

// עדכון פונקציית הנגינה הקיימת ב-app.js
async function playVideo(id, title, channel) {
    const playerDiv = document.getElementById('floating-player');
    const iframe = document.getElementById('youtubePlayer');
    
    playerDiv.style.display = 'block';
    iframe.src = `https://www.youtube.com/embed/${id}?autoplay=1&enablejsapi=1`;
    
    document.getElementById('current-title').innerText = title;
    document.getElementById('current-channel').innerText = channel;
    
    // ... שאר הקוד של ההיסטוריה שכתבת ...
}

document.getElementById('globalSearch')?.addEventListener('input', (e) => fetchVideos(e.target.value));
init();
