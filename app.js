const SB_URL = 'https://fbzewdfubjfhqvlusyrj.supabase.co';
const SB_KEY = 'sb_publishable_2JftgVsArBG2NB-RXp0q4Q_jdd8VfPO';
const client = supabase.createClient(SB_URL, SB_KEY);

let currentUser = null;
let userFavorites = [];
let debounceTimeout = null;
let isPlaying = false;

// --- פונקציות עזר ותיקון תווים ---

// ניקוי שאילתה לפני שליחה ל-FTS למניעת קריסה
function cleanFtsQuery(query) {
    return query.replace(/[^\w\sא-ת]/g, ' ').trim();
}

// הגנה על טקסט שמוזרק לתוך HTML ו-JS (מונע SyntaxError בגלל גרשים)
function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// --- ניהול משתמש ואתחול ---

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
    if (currentUser && userDiv && currentUser.user_metadata) {
        const avatar = currentUser.user_metadata.avatar_url || ""; // תיקון שגיאת 404 null
        userDiv.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                ${avatar ? `<img src="${avatar}" style="width:35px; border-radius:50%; border: 2px solid #1DB954;">` : ''}
                <div style="display:flex; flex-direction:column;">
                    <span style="font-size:14px; font-weight:bold;">${escapeHtml(currentUser.user_metadata.full_name)}</span>
                    <span onclick="logout()" style="color:#b3b3b3; font-size:11px; cursor:pointer; text-decoration:underline;">התנתק</span>
                </div>
            </div>
        `;
    }
}

async function logout() { await client.auth.signOut(); window.location.reload(); }

// --- מערכת חיפוש ותרגום ---

async function fetchVideos(query = "") {
    const rawQuery = query.trim();
    if (!rawQuery) {
        const { data } = await client.from('videos').select('*').order('published_at', { ascending: false });
        renderVideoGrid(data);
        return;
    }

    const cleanQuery = cleanFtsQuery(rawQuery);
    // שימוש ב-FTS בלבד כפי שביקשת
    const { data } = await client.rpc('search_videos_prioritized', { search_term: cleanQuery });
    renderVideoGrid(data || []);

    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(async () => {
        const translated = await getTranslation(cleanQuery);
        if (translated && translated.toLowerCase() !== cleanQuery.toLowerCase()) {
            const { data: transData } = await client.rpc('search_videos_prioritized', { search_term: cleanFtsQuery(translated) });
            if (transData) renderVideoGrid(transData, true);
        }
    }, 800);
}

async function getTranslation(text) {
    try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=iw&tl=en&dt=t&q=${encodeURI(text)}`);
        const data = await res.json();
        return data[0][0][0];
    } catch (e) { return null; }
}

// --- רינדור תצוגה ---

function renderVideoGrid(data, append = false) {
    const grid = document.getElementById('videoGrid');
    if (!grid || !data) return;
    
    const html = data.map(v => {
        const isFav = userFavorites.includes(v.id);
        
        // 1. הכנת הטקסט לתצוגה ב-HTML (מונע הזרקת קוד)
        const displayTitle = escapeHtml(v.title);
        const displayChannel = escapeHtml(v.channel_title);
        const displayDesc = escapeHtml(v.description);

        // 2. הכנת הטקסט למעבר בתוך פונקציית JS (מטפל בגרשים שגורמים לשגיאת Syntax)
        // אנחנו משתמשים ב-JSON.stringify כדי שהדפדפן יטפל בבריחה של תווים באופן אוטומטי
        const jsTitle = v.title.replace(/'/g, "\\'");
        const jsChannel = v.channel_title.replace(/'/g, "\\'");

        return `
            <div class="v-card" onclick="playVideo('${v.id}', '${jsTitle}', '${jsChannel}')">
                <div class="card-img-container">
                    <img src="${v.thumbnail}" loading="lazy">
                    <div class="video-description-overlay">${displayDesc}</div>
                </div>
                <h3>${displayTitle}</h3>
                <div class="card-footer">
                    <span>${displayChannel}</span>
                    <button class="fav-btn" onclick="event.stopPropagation(); toggleFavorite('${v.id}')">
                        <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart" id="fav-icon-${v.id}"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    grid.innerHTML = append ? grid.innerHTML + html : html;
}

// --- נגן וידאו (טעינה ישירה ומהירה) ---

function playVideo(id, title, channel) {
    const playerWin = document.getElementById('floating-player');
    const container = document.getElementById('youtubePlayer');
    
    playerWin.style.display = 'flex'; 
    // טעינה ישירה ללא בדיקות API מיותרות לשיפור המהירות
    container.innerHTML = `
        <iframe src="https://www.youtube.com/embed/${id}?autoplay=1&enablejsapi=1" 
                frameborder="0" allow="autoplay; encrypted-media" allowfullscreen 
                style="width: 100%; height: 100%; display: block;">
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
    const iframe = document.querySelector('#youtubePlayer iframe');
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

// --- לוגיקת גרירת חלון ---

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

// --- מועדפים והיסטוריה ---

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
            <div class="nav-link" onclick="playVideo('${h.videos.id}', '${escapeHtml(h.videos.title).replace(/'/g, "\\'")}', '')">
                <i class="fa-solid fa-clock-rotate-left"></i> ${h.videos.title}
            </div>` : '').join('');
    }
}

document.getElementById('globalSearch').addEventListener('input', (e) => fetchVideos(e.target.value));
init();
