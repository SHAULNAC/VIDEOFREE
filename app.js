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

let player; 
let isPlayerReady = false;

// 1. אתחול הנגן של יוטיוב
function onYouTubeIframeAPIReady() {
    player = new YT.Player('youtubePlayer', {
        height: '100%',
        width: '100%',
        playerVars: { 'autoplay': 1, 'controls': 1, 'rel': 0, 'modestbranding': 1 },
        events: {
            'onReady': () => { isPlayerReady = true; },
            'onStateChange': (event) => {
                const icon = document.getElementById('play-icon');
                if (event.data === YT.PlayerState.PLAYING) icon.classList.replace('fa-play', 'fa-pause');
                else icon.classList.replace('fa-pause', 'fa-play');
            }
        }
    });
}

// 2. פונקציית הנגינה המעודכנת
async function playVideo(id, title, channel) {
    const playerDiv = document.getElementById('floating-player');
    playerDiv.style.display = 'block';

    if (isPlayerReady) {
        player.loadVideoById(id);
    }

    document.getElementById('current-title').innerText = title;
    document.getElementById('current-channel').innerText = channel;

    // משיכת פרטים נוספים מה-DB (תאריך, תיאור, אורך)
    const { data, error } = await client.from('videos').select('*').eq('id', id).single();
    if (data) {
        document.getElementById('bottom-description').innerText = data.description || "";
        document.getElementById('video-duration').innerText = data.duration || "00:00";
        if (data.published_at) {
            document.getElementById('current-date').innerText = new Date(data.published_at).toLocaleDateString('he-IL');
        }
    }
}

// 3. שליטה במקלדת
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || !isPlayerReady) return;

    if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
    }
    if (e.code === 'ArrowRight') player.seekTo(player.getCurrentTime() + 5);
    if (e.code === 'ArrowLeft') player.seekTo(player.getCurrentTime() - 5);
});

function togglePlayPause() {
    if (player.getPlayerState() === 1) player.pauseVideo();
    else player.playVideo();
}

// 4. לוגיקת גרירה ושינוי גודל (Resize & Drag)
const floatingPlayer = document.getElementById('floating-player');
const dragHandle = document.getElementById('drag-handle');
const resizer = document.getElementById('resizer');

// גרירה
dragHandle.onmousedown = (e) => {
    let shiftX = e.clientX - floatingPlayer.getBoundingClientRect().left;
    let shiftY = e.clientY - floatingPlayer.getBoundingClientRect().top;
    
    const move = (e) => {
        floatingPlayer.style.left = e.clientX - shiftX + 'px';
        floatingPlayer.style.top = e.clientY - shiftY + 'px';
        floatingPlayer.style.bottom = 'auto';
    };
    
    document.onmousemove = move;
    document.onmouseup = () => document.onmousemove = null;
};

// שינוי גודל
resizer.onmousedown = (e) => {
    e.preventDefault();
    const startWidth = floatingPlayer.offsetWidth;
    const startHeight = floatingPlayer.offsetHeight;
    const startX = e.clientX;
    const startY = e.clientY;

    const resize = (e) => {
        const width = startWidth + (e.clientX - startX);
        const height = width * 0.5625; // שומר על יחס 16:9
        floatingPlayer.style.width = width + 'px';
        floatingPlayer.style.height = (height + 30) + 'px'; // +30 עבור ה-header
    };

    document.onmousemove = resize;
    document.onmouseup = () => document.onmousemove = null;
};

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
