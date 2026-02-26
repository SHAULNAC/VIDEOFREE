const SB_URL = 'https://fbzewdfubjfhqvlusyrj.supabase.co';
const SB_KEY = 'sb_publishable_2JftgVsArBG2NB-RXp0q4Q_jdd8VfPO';
const client = supabase.createClient(SB_URL, SB_KEY);

let currentUser = null;
let userFavorites = [];
let debounceTimeout = null;
let isPlaying = false;

const categoryMap = {
    "1": "סרטים ואנימציה", "2": "רכבים", "10": "מוזיקה", "15": "חיות מחמד",
    "17": "ספורט", "20": "גיימינג", "22": "אנשים ובלוגים", "23": "קומדיה",
    "24": "בידור", "25": "חדשות ופוליטיקה", "26": "מדריכים וסטייל",
    "27": "חינוך", "28": "מדע וטכנולוגיה"
};

// --- פונקציות עזר ---

function cleanForJS(text) {
    if (!text) return "";
    return text.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDuration(isoDuration) {
    if (!isoDuration || !isoDuration.startsWith('PT')) return "0:00";
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    const seconds = parseInt(match[3]) || 0;

    const parts = [];
    if (hours > 0) parts.push(hours);
    parts.push(hours > 0 ? minutes.toString().padStart(2, '0') : minutes);
    parts.push(seconds.toString().padStart(2, '0'));
    return parts.join(':');
}


async function init() {
    try {
        const { data: { user } } = await client.auth.getUser();
        currentUser = user;
        
        client.auth.onAuthStateChange((event, session) => {
            currentUser = session?.user || null;
            updateUserUI();
            if (currentUser) loadSidebarLists();
        });

        updateUserUI();
        
        if (currentUser) {
            const { data: favs } = await client.from('favorites')
                .select('video_id')
                .eq('user_id', currentUser.id);
            userFavorites = favs ? favs.map(f => f.video_id) : [];
            loadSidebarLists();
        }

        fetchVideos();
        initDraggable();
        initResizer(); 

    } catch (error) {
        console.error("Error during init:", error);
    }
}

function updateUserUI() {
    const userDiv = document.getElementById('user-profile');
    if (!userDiv) return;

    if (currentUser && currentUser.user_metadata) {
        const avatar = currentUser.user_metadata.avatar_url || "";
        userDiv.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                ${avatar ? `<img src="${avatar}" style="width:35px; border-radius:50%; border: 2px solid #1DB954;">` : ''}
                <div style="display:flex; flex-direction:column;">
                    <span style="font-size:14px; font-weight:bold;">${escapeHtml(currentUser.user_metadata.full_name)}</span>
                    <span onclick="logout()" style="color:#b3b3b3; font-size:11px; cursor:pointer; text-decoration:none;">התנתק</span>
                </div>
            </div>`;
    } else {
        userDiv.innerHTML = `<button class="btn-login" onclick="login()">התחבר עם Google</button>`;
    }
}

async function login() {
    const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin + window.location.pathname 
        }
    });
    if (error) console.error("Login error:", error.message);
}

async function logout() { 
    await client.auth.signOut(); 
    window.location.reload(); 
}

// --- חיפוש ---

async function fetchVideos(query = "") {
    const rawQuery = query.trim();
    if (!rawQuery) {
        const { data } = await client.from('videos').select('*').order('published_at', { ascending: false });
        renderVideoGrid(data);
        return;
    }

    const cleanQuery = rawQuery.replace(/[^\w\sא-ת]/g, ' ').trim();
    const { data } = await client.rpc('search_videos_prioritized', { search_term: cleanQuery });
    renderVideoGrid(data || []);

    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(async () => {
        const translated = await getTranslation(cleanQuery);
        if (translated && translated.toLowerCase() !== cleanQuery.toLowerCase()) {
            const { data: transData } = await client.rpc('search_videos_prioritized', { search_term: translated });
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

// --- רינדור ---

function renderVideoGrid(videos) {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;

    grid.innerHTML = videos.map(v => {
        const videoId = v.id;
        const title = escapeHtml(v.title);
        const channel = escapeHtml(v.channel_title);
        
        // יצירת אובייקט נתונים עבור ה-Base64
        const videoData = {
            id: videoId,
            t: v.title,
            c: v.channel_title,
            cat: categoryMap[v.category_id] || "כללי",
            v: v.views_count,
            l: v.likes_count,
            desc: v.description
        };
        const encodedData = btoa(encodeURIComponent(JSON.stringify(videoData)));

        // בדיקה האם הסרטון נמצא במועדפים
        const isFav = userFavorites.includes(videoId);
        // אם הוא במועדפים - לב מלא (fa-solid), אם לא - לב ריק (fa-regular)
        const favIconClass = isFav ? 'fa-solid' : 'fa-regular';

        return `
            <div class="v-card" onclick="preparePlay('${encodedData}')">
                <div class="v-thumb">
                    <img src="${v.thumbnail_url}" alt="${title}" loading="lazy">
                    <span class="v-duration">${v.duration || ''}</span>
                    <button class="fav-btn" onclick="event.stopPropagation(); toggleFavorite('${videoId}')">
                        <i class="${favIconClass} fa-heart" id="fav-icon-${videoId}"></i>
                    </button>
                </div>
                <div class="v-info">
                    <h3 title="${title}">${title}</h3>
                    <p>${channel}</p>
                </div>
            </div>
        `;
    }).join('');
}
function preparePlay(encodedData) {
    try {
        // 1. פיענוח נתוני הסרטון
        const data = JSON.parse(decodeURIComponent(atob(encodedData)));
        
        const playerWin = document.getElementById('floating-player');
        const playerBar = document.getElementById('main-player-bar'); 
        const container = document.getElementById('youtubePlayer');
        
        if (!playerWin || !container) return;

        // 2. הצגת חלון הנגן והסרגל התחתון
        playerWin.style.display = 'flex'; 
        if (playerBar) {
            playerBar.classList.remove('hidden-player');
            playerBar.classList.add('show-player');
        }

        // 3. בניית כתובת ה-URL של יוטיוב
        const videoParams = new URLSearchParams({
            autoplay: 1,
            enablejsapi: 1,
            rel: 0,
            origin: window.location.origin
        });

        // 4. הזרקת המבנה המלא: Loader + IFrame (שינוי לשרת youtube.com הרגיל)
        container.innerHTML = `
            <div id="player-loader" class="player-loader">
                <i class="fa-solid fa-play"></i>
                </div>
            <iframe id="yt-iframe" 
                src="https://www.youtube.com/embed/${data.id}?${videoParams.toString()}" 
                frameborder="0" 
                allow="autoplay; encrypted-media; picture-in-picture" 
                allowfullscreen
                style="opacity: 0; width: 100%; height: 100%; transition: opacity 0.5s ease; position: absolute; top: 0; left: 0; z-index: 2;"
                onload="const loader = document.getElementById('player-loader'); if(loader) loader.style.display='none'; this.style.opacity='1';">
            </iframe>`;
        
        // 5. עדכון פרטי הטקסט בסרגל הנגן
        if (document.getElementById('current-title')) 
            document.getElementById('current-title').textContent = data.t || "ללא כותרת";
            
        if (document.getElementById('current-channel')) 
            document.getElementById('current-channel').textContent = data.c || "";
        
        const catElem = document.getElementById('current-category');
        if (catElem) catElem.textContent = data.cat || "כללי";
        
        if (document.getElementById('stat-views')) 
            document.getElementById('stat-views').innerHTML = `<i class="fa-solid fa-eye"></i> ${data.v || 0}`;
        
        if (document.getElementById('stat-likes')) 
            document.getElementById('stat-likes').innerHTML = `<i class="fa-solid fa-thumbs-up"></i> ${data.l || 0}`;
        
        const descElem = document.getElementById('bottom-description');
        if (descElem) descElem.textContent = data.desc || "";

        // 6. עדכון להיסטוריה ב-Supabase (אם מחובר)
        if (typeof currentUser !== 'undefined' && currentUser) {
            client.from('history').upsert([
                { user_id: currentUser.id, video_id: data.id, created_at: new Date() }
            ]).then(() => {
                if (typeof loadSidebarLists === 'function') loadSidebarLists();
            });
        }

    } catch (e) { 
        console.error("שגיאה בהפעלת הסרטון:", e); 
    }
}

function closePlayer() {
    const playerWin = document.getElementById('floating-player');
    const container = document.getElementById('youtubePlayer');
    if (playerWin) playerWin.style.display = 'none';
    if (container) container.innerHTML = ''; 
    isPlaying = false;
    updatePlayStatus(false);
}

function initDraggable() {
    const player = document.getElementById('floating-player');
    const handle = document.getElementById('drag-handle');
    if(!player || !handle) return;
    
    let isDragging = false;
    let offsetX, offsetY;

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - player.offsetLeft;
        offsetY = e.clientY - player.offsetTop;
        player.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        player.style.left = `${e.clientX - offsetX}px`;
        player.style.top = `${e.clientY - offsetY}px`;
        player.style.bottom = 'auto'; 
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

function initResizer() {
    const player = document.getElementById('floating-player');
    const resizer = document.getElementById('resizer');
    if(!player || !resizer) return;
    
    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        window.addEventListener('mousemove', resize);
        window.addEventListener('mouseup', stopResize);
    });

    function resize(e) {
        const newWidth = e.clientX - player.offsetLeft;
        const newHeight = e.clientY - player.offsetTop;
        if (newWidth > 200) player.style.width = newWidth + 'px';
        if (newHeight > 150) player.style.height = newHeight + 'px';
    }

    function stopResize() {
        window.removeEventListener('mousemove', resize);
        window.removeEventListener('mouseup', stopResize);
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

async function toggleFavorite(videoId) {
    if (!currentUser) return alert("עליך להתחבר כדי להוסיף למועדפים");
    const isFav = userFavorites.includes(videoId);
    if (isFav) {
        await client.from('favorites').delete().eq('user_id', currentUser.id).eq('video_id', videoId);
        userFavorites = userFavorites.filter(id => id !== videoId);
    } else {
        await client.from('favorites').insert([{ user_id: currentUser.id, video_id: videoId }]);
        userFavorites.push(videoId);
    }
    const icon = document.getElementById(`fav-icon-${videoId}`);
    if (icon) icon.className = userFavorites.includes(videoId) ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
}

function showEfficiencyPoll(videoId) {
    const poll = document.createElement('div');
    poll.className = 'feedback-toast';
    poll.innerHTML = `
        <p style="margin:0 0 10px 0; font-size:13px;">כמה הסרטון היה שימושי?</p>
        <button class="feedback-btn" onclick="submitEfficiency('${videoId}', 10, this)">מאוד שימושי</button>
        <button class="feedback-btn" onclick="submitEfficiency('${videoId}', 5, this)">ככה ככה</button>
        <button class="feedback-btn" onclick="submitEfficiency('${videoId}', 0, this)">לא עזר</button>
    `;
    document.body.appendChild(poll);
}

async function submitEfficiency(videoId, score, btn) {
    const { error } = await client.from('videos').update({ efficiency_score: score }).eq('id', videoId);
    if (!error) {
        btn.parentElement.innerHTML = "תודה על המשוב!";
        setTimeout(() => document.querySelectorAll('.feedback-toast').forEach(t => t.remove()), 2000);
    }
}

async function loadSidebarLists() {
    if (!currentUser) return;
    const sidebarList = document.getElementById('favorites-list');
    if (sidebarList) {
        sidebarList.innerHTML = `
            <div class="nav-link" onclick='displayHistory()'>
                <i class="fa-solid fa-clock-rotate-left"></i>
                <span>היסטוריית צפייה</span>
            </div>
            <div class="nav-link" onclick='displayFavorites()'>
                <i class="fa-solid fa-heart"></i>
                <span>סרטונים שאהבתי</span>
            </div>
        `;
    }
}

async function displayHistory() {
    if (!currentUser) return;
    const { data } = await client.from('history').select('*, videos(*)').eq('user_id', currentUser.id).order('created_at', { ascending: false });
    const title = document.getElementById('main-title');
    if (title) title.textContent = "היסטוריית צפייה";
    if (data) renderVideoGrid(data.map(i => i.videos).filter(v => v));
}

async function displayFavorites() {
    if (!currentUser) return;
    const { data } = await client.from('favorites').select('*, videos(*)').eq('user_id', currentUser.id);
    const title = document.getElementById('main-title');
    if (title) title.textContent = "מועדפים";
    if (data) renderVideoGrid(data.map(i => i.videos).filter(v => v));
}
function showPrivacy() {
    const modal = document.getElementById('privacy-modal');
    if (modal) modal.style.display = 'flex';
}

function closePrivacy() {
    const modal = document.getElementById('privacy-modal');
    if (modal) modal.style.display = 'none';
}

// סגירה בלחיצה מחוץ למודאל
window.onclick = function(event) {
    const modal = document.getElementById('privacy-modal');
    if (event.target == modal) {
        closePrivacy();
    }
}// --- אתחול ---

// מאזינים לאירועים
document.getElementById('globalSearch').addEventListener('input', (e) => fetchVideos(e.target.value));

// הפעלה
init();
