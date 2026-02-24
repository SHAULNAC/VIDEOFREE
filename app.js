const SB_URL = 'https://fbzewdfubjfhqvlusyrj.supabase.co';
const SB_KEY = 'sb_publishable_2JftgVsArBG2NB-RXp0q4Q_jdd8VfPO';
const client = supabase.createClient(SB_URL, SB_KEY);

let currentUser = null;
let userFavorites = [];
let player = null; 
let isPlayerReady = false;

async function init() {
    const { data: { user } } = await client.auth.getUser();
    currentUser = user;
    updateUserUI();
    
    if (user) {
        const { data: favs } = await client.from('favorites').select('video_id').eq('user_id', user.id);
        userFavorites = favs ? favs.map(f => f.video_id) : [];
        loadSidebarLists();
    }
    
    fetchVideos(); // טעינה ראשונית של הגלריה
}

function updateUserUI() {
    const userDiv = document.getElementById('user-profile');
    if (currentUser && userDiv) {
        userDiv.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <img src="${currentUser.user_metadata.avatar_url}" style="width:35px; border-radius:50%; border: 2px solid #1DB954;">
                <div style="display:flex; flex-direction:column;">
                    <span style="font-size:14px; font-weight:bold;">${currentUser.user_metadata.full_name}</span>
                    <span onclick="logout()" style="color:#b3b3b3; font-size:11px; cursor:pointer; text-decoration:underline;">התנתק</span>
                </div>
            </div>
        `;
    }
}

async function login() { await client.auth.signInWithOAuth({ provider: 'google' }); }
async function logout() { await client.auth.signOut(); window.location.reload(); }

async function fetchVideos(query = "") {
    const searchQuery = query.trim();
    let data;
    if (!searchQuery) {
        const result = await client.from('videos').select('*').order('published_at', { ascending: false });
        data = result.data;
    } else {
        const result = await client.rpc('search_videos_prioritized', { search_term: searchQuery });
        data = result.data;
    }
    renderVideoGrid(data || []);
}

function renderVideoGrid(data) {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;
    
    if (data.length === 0) {
        grid.innerHTML = "<p style='padding:20px;'>לא נמצאו סרטונים.</p>";
        return;
    }

    grid.innerHTML = data.map(v => {
        const isFav = userFavorites.includes(v.id);
        // טיפול בערכי null למניעת קריסה
        const safeTitle = (v.title || "ללא כותרת").replace(/'/g, "\\'");
        const safeChannel = (v.channel_title || "ערוץ לא ידוע").replace(/'/g, "\\'");
        const safeDesc = (v.description || "").replace(/'/g, "\\'");

        return `
            <div class="v-card" onclick="playVideo('${v.id}', '${safeTitle}', '${safeChannel}')">
                <div class="card-img-container">
                    <img src="${v.thumbnail || ''}" loading="lazy">
                    <div class="video-description-overlay">${safeDesc}</div>
                </div>
                <h3>${v.title || 'ללא כותרת'}</h3>
                <div class="card-footer">
                    <span>${v.channel_title || ''}</span>
                    <button class="fav-btn" onclick="event.stopPropagation(); toggleFavorite('${v.id}')">
                        <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart" id="fav-icon-${v.id}"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// YouTube API
function onYouTubeIframeAPIReady() {
    player = new YT.Player('youtubePlayer', {
        height: '100%',
        width: '100%',
        videoId: '', // מתחיל ריק
        playerVars: { 
            'autoplay': 1, 
            'controls': 1, 
            'rel': 0,
            'origin': window.location.origin,
            'enablejsapi': 1 
        },
        events: {
            'onReady': () => { isPlayerReady = true; },
            'onError': (e) => console.log("YT Player Error:", e),
            'onStateChange': (event) => {
                const icon = document.getElementById('play-icon');
                if (event.data === YT.PlayerState.PLAYING) icon?.classList.replace('fa-play', 'fa-pause');
                else icon?.classList.replace('fa-pause', 'fa-play');
            }
        }
    });
}

async function playVideo(id, title, channel) {
    const floatingPlayer = document.getElementById('floating-player');
    floatingPlayer.style.display = 'block';
    
    // ניסיון טעינה דרך ה-API, ואם לא מצליח - טעינה ישירה ל-SRC
    if (isPlayerReady && player && typeof player.loadVideoById === 'function') {
        player.loadVideoById(id);
    } else {
        const iframe = document.querySelector('#youtubePlayer iframe') || document.getElementById('youtubePlayer');
        if (iframe) {
            iframe.src = `https://www.youtube.com/embed/${id}?autoplay=1&enablejsapi=1&origin=${window.location.origin}`;
        }
    }

    document.getElementById('current-title').innerText = title;
    document.getElementById('current-channel').innerText = channel;

    if (currentUser) {
        await client.from('history').upsert({ user_id: currentUser.id, video_id: id, created_at: new Date() });
        loadSidebarLists();
    }
}

// לוגיקת גרירה
const floatingWin = document.getElementById('floating-player');
const handle = document.getElementById('drag-handle');

handle.onmousedown = function(e) {
    let rect = floatingWin.getBoundingClientRect();
    let shiftX = e.clientX - rect.left;
    let shiftY = e.clientY - rect.top;
    
    function moveAt(pageX, pageY) {
        floatingWin.style.left = pageX - shiftX + 'px';
        floatingWin.style.top = pageY - shiftY + 'px';
        floatingWin.style.bottom = 'auto';
    }
    
    function onMouseMove(e) { moveAt(e.clientX, e.clientY); }
    document.addEventListener('mousemove', onMouseMove);
    document.onmouseup = () => document.removeEventListener('mousemove', onMouseMove);
};

// יתר הפונקציות (Favorite, Sidebar) נשארות כפי שהיו
async function toggleFavorite(videoId) {
    if (!currentUser) return alert("עליך להתחבר");
    const isCurrentlyFav = userFavorites.includes(videoId);
    if (isCurrentlyFav) {
        await client.from('favorites').delete().eq('user_id', currentUser.id).eq('video_id', videoId);
        userFavorites = userFavorites.filter(id => id !== videoId);
    } else {
        await client.from('favorites').insert([{ user_id: currentUser.id, video_id: videoId }]);
        userFavorites.push(videoId);
    }
    loadSidebarLists();
    // עדכון האייקון בלבד במקום רענון כל הגריד
    const icon = document.getElementById(`fav-icon-${videoId}`);
    if(icon) icon.className = userFavorites.includes(videoId) ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
}

async function loadSidebarLists() {
    if (!currentUser) return;
    const { data: favs } = await client.from('favorites').select('video_id, videos(id, title)').eq('user_id', currentUser.id);
    if (favs) {
        document.getElementById('favorites-list').innerHTML = favs.map(f => f.videos ? `
            <div class="nav-link" onclick="playVideo('${f.videos.id}', '${f.videos.title.replace(/'/g, "\\'")}', '')">
                <i class="fa-solid fa-play" style="font-size:10px;"></i> ${f.videos.title}
            </div>` : '').join('');
    }
}

document.getElementById('globalSearch').addEventListener('input', (e) => fetchVideos(e.target.value));
init();
