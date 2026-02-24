const SB_URL = 'https://fbzewdfubjfhqvlusyrj.supabase.co';
const SB_KEY = 'sb_publishable_2JftgVsArBG2NB-RXp0q4Q_jdd8VfPO';
const client = supabase.createClient(SB_URL, SB_KEY);

let currentUser = null;
let userFavorites = [];
let debounceTimeout = null;
let isPlaying = false;

// פונקציית עזר לניקוי גרשים ותווים מיוחדים
function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

async function init() {
    const { data: { user } } = await client.auth.getUser();
    currentUser = user;
    updateUserUI();
    
    if (user) {
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

async function getTranslation(text) {
    const cleanText = text.trim().toLowerCase();
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=iw&tl=en&dt=t&q=${encodeURI(cleanText)}`);
        const data = await res.json();
        return data[0][0][0];
    } catch (e) { return null; }
}

async function fetchVideos(query = "") {
    const searchQuery = query.trim();
    if (!searchQuery) {
        const { data } = await client.from('videos').select('*').order('published_at', { ascending: false });
        renderVideoGrid(data);
        return;
    }

    // חיפוש FTS ראשוני
    const { data, error } = await client.rpc('search_videos_prioritized', { search_term: searchQuery });
    if (!error) renderVideoGrid(data);

    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(async () => {
        const translated = await getTranslation(searchQuery);
        if (translated && translated.toLowerCase() !== searchQuery.toLowerCase()) {
            const { data: transData } = await client.rpc('search_videos_prioritized', { search_term: translated });
            if (transData) renderVideoGrid(transData, true);
        }
    }, 800);
}

function renderVideoGrid(data, append = false) {
    const grid = document.getElementById('videoGrid');
    if (!grid || !data) return;
    
    const html = data.map(v => {
        const isFav = userFavorites.includes(v.id);
        const safeTitle = escapeHtml(v.title);
        const safeChannel = escapeHtml(v.channel_title);
        const safeDesc = escapeHtml(v.description);

        return `
            <div class="v-card" onclick="playVideo('${v.id}', '${safeTitle}', '${safeChannel}')">
                <div class="card-img-container">
                    <img src="${v.thumbnail}" loading="lazy">
                    <div class="video-description-overlay">${safeDesc}</div>
                </div>
                <h3>${v.title}</h3>
                <div class="card-footer">
                    <span>${v.channel_title}</span>
                    <button class="fav-btn" onclick="event.stopPropagation(); toggleFavorite('${v.id}')">
                        <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart" id="fav-icon-${v.id}"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    grid.innerHTML = append ? grid.innerHTML + html : html;
}

function playVideo(id, title, channel) {
    const playerWin = document.getElementById('floating-player');
    const container = document.getElementById('youtubePlayer');
    
    playerWin.style.display = 'block';
    // עיצוב ה-iframe למניעת חיתוך בתחתית
    container.innerHTML = `
        <iframe id="yt-iframe" 
                src="https://www.youtube.com/embed/${id}?autoplay=1&enablejsapi=1&rel=0" 
                style="width:100%; height:100%; min-height:200px; display:block;"
                frameborder="0" 
                allow="autoplay; encrypted-media" 
                allowfullscreen>
        </iframe>`;
    
    document.getElementById('current-title').innerText = title;
    document.getElementById('current-channel').innerText = channel;
    isPlaying = true;
    updatePlayStatus(true);

    if (currentUser) {
        client.from('history').upsert({ user_id: currentUser.id, video_id: id, created_at: new Date() });
    }
}

function togglePlayPause() {
    const iframe = document.getElementById('yt-iframe');
    if (!iframe) return;
    const action = isPlaying ? 'pauseVideo' : 'playVideo';
    iframe.contentWindow.postMessage(JSON.stringify({"event": "command", "func": action, "args": ""}), "*");
    isPlaying = !isPlaying;
    updatePlayStatus(isPlaying);
}

function updatePlayStatus(playing) {
    const icon = document.getElementById('play-icon');
    if (icon) icon.className = playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
}

// לוגיקת גרירה
const floatingPlayer = document.getElementById('floating-player');
const dragHandle = document.getElementById('drag-handle');

if (dragHandle) {
    dragHandle.onmousedown = function(e) {
        e.preventDefault();
        const rect = floatingPlayer.getBoundingClientRect();
        let shiftX = e.clientX - rect.left;
        let shiftY = e.clientY - rect.top;

        function moveAt(pageX, pageY) {
            floatingPlayer.style.left = pageX - shiftX + 'px';
            floatingPlayer.style.top = pageY - shiftY + 'px';
            floatingPlayer.style.bottom = 'auto';
        }

        function onMouseMove(event) { moveAt(event.clientX, event.clientY); }
        document.addEventListener('mousemove', onMouseMove);
        document.onmouseup = function() {
            document.removeEventListener('mousemove', onMouseMove);
            document.onmouseup = null;
        };
    };
    dragHandle.ondragstart = function() { return false; };
}

async function toggleFavorite(videoId) {
    if (!currentUser) return alert("התחבר קודם");
    const isFav = userFavorites.includes(videoId);
    if (isFav) {
        await client.from('favorites').delete().eq('user_id', currentUser.id).eq('video_id', videoId);
        userFavorites = userFavorites.filter(id => id !== videoId);
    } else {
        await client.from('favorites').insert([{ user_id: currentUser.id, video_id: videoId }]);
        userFavorites.push(videoId);
    }
    const icon = document.getElementById(`fav-icon-${videoId}`);
    if(icon) icon.className = userFavorites.includes(videoId) ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
}

async function loadSidebarLists() {
    if (!currentUser) return;
    const { data: hist } = await client.from('history').select('video_id, videos(id, title)').eq('user_id', currentUser.id).limit(10).order('created_at', {ascending: false});
    if (hist) {
        document.getElementById('favorites-list').innerHTML = hist.map(h => h.videos ? `
            <div class="nav-link" onclick="playVideo('${h.videos.id}', '${escapeHtml(h.videos.title)}', '')">
                <i class="fa-solid fa-clock-rotate-left"></i> ${h.videos.title}
            </div>` : '').join('');
    }
}

document.getElementById('globalSearch').addEventListener('input', (e) => fetchVideos(e.target.value));
init();
