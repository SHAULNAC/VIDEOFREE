const SB_URL = 'https://fbzewdfubjfhqvlusyrj.supabase.co';
const SB_KEY = 'sb_publishable_2JftgVsArBG2NB-RXp0q4Q_jdd8VfPO';
const client = supabase.createClient(SB_URL, SB_KEY);

let currentUser = null;

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
    if (currentUser) {
        userDiv.innerHTML = `
            <img src="${currentUser.user_metadata.avatar_url}" style="width:35px; border-radius:50%; border: 2px solid #1DB954;">
            <div style="display:flex; flex-direction:column;">
                <span style="font-size:14px; font-weight:bold;">${currentUser.user_metadata.full_name}</span>
                <span onclick="logout()" style="color:#b3b3b3; font-size:11px; cursor:pointer; text-decoration:underline;">התנתק</span>
            </div>
        `;
    }
}

// --- טעינת סרטונים וחיפוש ---
async function fetchVideos(query = "") {
    let request = client.from('videos').select('*');
    
    // שימוש בחיפוש החכם שהגדרנו ב-SQL
    if (query) {
        request = request.textSearch('fts_doc', query, {
            config: 'english',
            type: 'plain'
        });
    }
    
    const { data, error } = await request.order('added_at', { ascending: false });
    if (error) return console.error(error);

    const grid = document.getElementById('videoGrid');
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
        loadSidebarLists(); // רענון רשימת הצפיות האחרונות
    }
}

// --- טעינת רשימות לתפריט צד ---
async function loadSidebarLists() {
    if (!currentUser) return;

    // צפיות אחרונות (History)
    const { data: history } = await client
        .from('history')
        .select('videos(id, title)')
        .eq('user_id', currentUser.id)
        .order('watched_at', { ascending: false })
        .limit(5);

    const sidebarList = document.getElementById('favorites-list');
    if (history) {
        sidebarList.innerHTML = '<p style="font-size:12px; color:#b3b3b3; margin-bottom:10px;">צפיות אחרונות</p>' + 
        history.map(h => `
            <div class="nav-link" style="font-size:13px; padding:5px 0;" onclick="playVideo('${h.videos.id}', '${h.videos.title}', '')">
                <i class="fa-solid fa-clock-rotate-left" style="font-size:12px;"></i> ${h.videos.title}
            </div>
        `).join('');
    }
}

// --- פונקציות עזר ---
async function login() { await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } }); }
async function logout() { await client.auth.signOut(); window.location.reload(); }

document.getElementById('globalSearch').addEventListener('input', (e) => fetchVideos(e.target.value));

init();
