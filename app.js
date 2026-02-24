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

// --- אתחול ---

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
    initDraggable(); // הפעלת הגרירה
}

function updateUserUI() {
    const userDiv = document.getElementById('user-profile');
    if (currentUser && userDiv && currentUser.user_metadata) {
        const avatar = currentUser.user_metadata.avatar_url || "";
        userDiv.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                ${avatar ? `<img src="${avatar}" style="width:35px; border-radius:50%; border: 2px solid #1DB954;">` : ''}
                <div style="display:flex; flex-direction:column;">
                    <span style="font-size:14px; font-weight:bold;">${escapeHtml(currentUser.user_metadata.full_name)}</span>
                    <span onclick="logout()" style="color:#b3b3b3; font-size:11px; cursor:pointer; text-decoration:underline;">התנתק</span>
                </div>
            </div>`;
    }
}

async function logout() { await client.auth.signOut(); window.location.reload(); }

// --- חיפוש ---

async function fetchVideos(query = "") {
    const rawQuery = query.trim();
    if (!rawQuery) {
        const { data } = await client.from('videos').select('*').order('published_at', { ascending: false });
        renderVideoGrid(data);
        return;
    }

    const cleanQuery = rawQuery.replace(/[^\w\sא-ת]/g, ' ').trim();
    
    // בחיפוש FTS ב-Supabase, מומלץ להשתמש ב-RPC שמוגדר עם תעדוף (A לכותרת, B לתיאור)
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

function renderVideoGrid(data, append = false) {
    const grid = document.getElementById('videoGrid');
    if (!grid || !data) return;
    
    const html = data.map(v => {
        const isFav = userFavorites.includes(v.id);
        
        // יצירת אובייקט נתונים ואריזתו ב-Base64 חסין לשגיאות Syntax
        const videoData = {
            id: v.id,
            title: v.title,
            channel: v.channel_title
        };
        // מקודדים ל-UTF8 ואז ל-Base64 כדי לתמוך בעברית וגרשים
        const safeData = btoa(unescape(encodeURIComponent(JSON.stringify(videoData))));

        return `
            <div class="v-card" onclick="preparePlay('${safeData}')">
                <div class="card-img-container">
                    <img src="${v.thumbnail}" loading="lazy">
                    <div class="video-description-overlay">${escapeHtml(v.description)}</div>
                </div>
                <h3>${escapeHtml(v.title)}</h3>
                <div class="card-footer">
                    <span>${escapeHtml(v.channel_title)}</span>
                    <button class="fav-btn" onclick="event.stopPropagation(); toggleFavorite('${v.id}')">
                        <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart" id="fav-icon-${v.id}"></i>
                    </button>
                </div>
            </div>`;
    }).join('');
    grid.innerHTML = append ? grid.innerHTML + html : html;
}
function preparePlay(encodedData) {
    try {
        const decodedData = JSON.parse(decodeURIComponent(atob(encodedData)));
        playVideo(decodedData.id, decodedData.title, decodedData.channel);
    } catch (e) {
        console.error("שגיאה בפענוח נתוני סרטון:", e);
    }
}
// --- נגן וגרירה ---



function playVideo(id, title, channel) {
    const playerWin = document.getElementById('floating-player');
    const container = document.getElementById('youtubePlayer');
    
    if (!playerWin || !container) return;

    playerWin.style.display = 'flex'; 
    
    /* הסבר על הפרמטרים למהירות בנטפרי:
       1. youtube-nocookie.com: מונע מראש טעינה של הרבה סקריפטים של מעקב ופרסומות.
       2. iv_load_policy=3: מבטל את ה-Annotations (הסיבה העיקרית לעיכוב בסינון).
       3. disablekb=1: מונע טעינת סקריפט לשליטה במקלדת (חוסך עוד בקשת רשת).
       4. widget_referrer: עוזר ליוטיוב לדלג על בדיקות CORS מסוימות.
    */
    const params = new URLSearchParams({
        autoplay: 1,
        enablejsapi: 1,
        rel: 0,
        iv_load_policy: 3, 
        disablekb: 1,
        showinfo: 0,
        controls: 1,
        origin: window.location.origin,
        widget_referrer: 'https://www.youtube.com'
    });

    // שימוש בדומיין המופחת-עוגיות של יוטיוב מזרז משמעותית את הטעינה בנטפרי
    container.innerHTML = `
        <iframe id="yt-iframe" 
                src="https://www.youtube-nocookie.com/embed/${id}?${params.toString()}" 
                frameborder="0" 
                allow="autoplay; encrypted-media; picture-in-picture" 
                allowfullscreen>
        </iframe>`;
    
    document.getElementById('current-title').innerText = title;
    document.getElementById('current-channel').innerText = channel;
    
    // שמירת היסטוריה
    if (currentUser) {
        client.from('history').upsert([
            { user_id: currentUser.id, video_id: id, created_at: new Date() }
        ]).then(() => loadSidebarLists());
    }

    isPlaying = true;
    if (typeof updatePlayStatus === 'function') updatePlayStatus(true);
}

function initDraggable() {
    const player = document.getElementById('floating-player');
    const handle = document.getElementById('drag-handle');
    let isDragging = false;
    let offsetX, offsetY;

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - player.offsetLeft;
        offsetY = e.clientY - player.offsetTop;
        player.style.transition = 'none'; // ביטול אנימציה בזמן גרירה
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        player.style.left = `${e.clientX - offsetX}px`;
        player.style.top = `${e.clientY - offsetY}px`;
        player.style.bottom = 'auto'; // מבטל הצמדה לתחתית
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
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

async function loadSidebarLists() {
    if (!currentUser) return;
    const { data: hist } = await client.from('history').select('video_id, videos(id, title, channel_title)').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(10);
    if (hist) {
        const sidebarList = document.getElementById('favorites-list');
        sidebarList.innerHTML = hist.map(h => {
            if (!h.videos) return '';
            const videoData = JSON.stringify({id: h.videos.id, title: cleanForJS(h.videos.title), channel: cleanForJS(h.videos.channel_title)}).replace(/"/g, '&quot;');
            return `
                <div class="nav-link" onclick='preparePlay(${videoData})'>
                    <i class="fa-solid fa-clock-rotate-left"></i>
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(h.videos.title)}</span>
                </div>`;
        }).join('');
    }
}

document.getElementById('globalSearch').addEventListener('input', (e) => fetchVideos(e.target.value));
init();
