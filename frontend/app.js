const { createApp, ref, onMounted, computed, watch } = Vue;

const API_BASE = 'http://localhost:3121/api';

const STAT_INDICATORS = [
  { key: 'monthlyCount', label: '本月记录数', icon: '📅' },
  { key: 'avgLucidity', label: '平均清醒度', icon: '👁️' },
  { key: 'streakDays', label: '连续记录天数', icon: '🔥' },
  { key: 'favoriteCount', label: '收藏数', icon: '⭐' },
  { key: 'taskCount', label: '任务数', icon: '✅' }
];

const DEFAULT_SELECTED = ['monthlyCount', 'avgLucidity', 'streakDays', 'favoriteCount', 'taskCount'];

createApp({
  setup() {
    const isLoggedIn = ref(false);
    const user = ref(null);
    const token = ref(null);

    const loginForm = ref({ username: '', password: '' });
    const loginLoading = ref(false);
    const loginError = ref('');

    const dreams = ref([]);
    const randomDream = ref(null);
    const monthlyStats = ref({ count: 0, avgLucidity: 0 });

    const summaryStats = ref({
      monthlyCount: 0,
      avgLucidity: 0,
      streakDays: 0,
      favoriteCount: 0,
      taskCount: 0
    });

    const selectedIndicators = ref([...DEFAULT_SELECTED]);
    const showStatsSettings = ref(false);

    const tasks = ref([]);
    const newTaskContent = ref('');

    const now = new Date();
    const selectedYear = ref(now.getFullYear());
    const selectedMonth = ref(now.getMonth() + 1);
    const yearOptions = computed(() => {
      const current = new Date().getFullYear();
      const years = [];
      for (let y = current - 5; y <= current; y++) {
        years.push(y);
      }
      return years;
    });

    const newDream = ref({
      content: '',
      lucidity: 3,
      date: new Date().toISOString().split('T')[0]
    });

    const isPlaying = ref(false);
    let audioContext = null;
    let noiseNode = null;
    let gainNode = null;

    const statIndicators = STAT_INDICATORS;

    const visibleStats = computed(() => {
      return STAT_INDICATORS.filter(s => selectedIndicators.value.includes(s.key));
    });

    function getToken() {
      return localStorage.getItem('dream_token');
    }

    function saveToken(t) {
      localStorage.setItem('dream_token', t);
      token.value = t;
    }

    function clearToken() {
      localStorage.removeItem('dream_token');
      token.value = null;
    }

    function saveUser(u) {
      localStorage.setItem('dream_user', JSON.stringify(u));
      user.value = u;
    }

    function loadUser() {
      const saved = localStorage.getItem('dream_user');
      if (saved) {
        user.value = JSON.parse(saved);
        isLoggedIn.value = true;
      }
    }

    function loadSelectedIndicators() {
      const saved = localStorage.getItem('dream_stat_indicators');
      if (saved) {
        try {
          selectedIndicators.value = JSON.parse(saved);
        } catch (e) {
          selectedIndicators.value = [...DEFAULT_SELECTED];
        }
      }
    }

    function saveSelectedIndicators() {
      localStorage.setItem('dream_stat_indicators', JSON.stringify(selectedIndicators.value));
    }

    function toggleIndicator(key) {
      const idx = selectedIndicators.value.indexOf(key);
      if (idx >= 0) {
        if (selectedIndicators.value.length > 1) {
          selectedIndicators.value.splice(idx, 1);
        }
      } else {
        selectedIndicators.value.push(key);
      }
      saveSelectedIndicators();
    }

    function isIndicatorSelected(key) {
      return selectedIndicators.value.includes(key);
    }

    function getStatValue(key) {
      return summaryStats.value[key] ?? 0;
    }

    async function apiRequest(url, options = {}) {
      const headers = { 'Content-Type': 'application/json', ...options.headers };
      const t = getToken();
      if (t) {
        headers['Authorization'] = `Bearer ${t}`;
      }

      const response = await fetch(`${API_BASE}${url}`, {
        ...options,
        headers
      });

      if (response.status === 401 || response.status === 403) {
        clearToken();
        isLoggedIn.value = false;
        user.value = null;
        throw new Error('未登录');
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '请求失败');
      }
      return data;
    }

    async function handleLogin() {
      if (!loginForm.value.username || !loginForm.value.password) {
        loginError.value = '请输入用户名和密码';
        return;
      }

      loginLoading.value = true;
      loginError.value = '';

      try {
        const data = await apiRequest('/login', {
          method: 'POST',
          body: JSON.stringify(loginForm.value)
        });

        saveToken(data.token);
        saveUser(data.user);
        isLoggedIn.value = true;
        loadData();
      } catch (e) {
        loginError.value = e.message;
      } finally {
        loginLoading.value = false;
      }
    }

    function handleLogout() {
      clearToken();
      stopWhiteNoise();
      isLoggedIn.value = false;
      user.value = null;
      dreams.value = [];
      randomDream.value = null;
      tasks.value = [];
    }

    async function fetchDreams() {
      try {
        const data = await apiRequest('/dreams');
        dreams.value = data;
      } catch (e) {
        console.error('获取梦境列表失败', e);
      }
    }

    async function fetchRandomDream() {
      try {
        const data = await apiRequest('/dreams/random');
        randomDream.value = data;
        if (!isPlaying.value) {
          startWhiteNoise();
          setTimeout(() => {
            stopWhiteNoise();
          }, 12000);
        }
      } catch (e) {
        alert(e.message);
      }
    }

    async function fetchMonthlyStats() {
      try {
        const data = await apiRequest(`/stats/monthly?year=${selectedYear.value}&month=${selectedMonth.value}`);
        monthlyStats.value = data;
      } catch (e) {
        console.error('获取月度统计失败', e);
      }
    }

    async function fetchSummaryStats() {
      try {
        const data = await apiRequest('/stats/summary');
        summaryStats.value = data;
      } catch (e) {
        console.error('获取统计摘要失败', e);
      }
    }

    async function toggleFavorite(dream) {
      try {
        await apiRequest(`/dreams/${dream.id}/favorite`, { method: 'PATCH' });
        dream.favorite = !dream.favorite;
        fetchSummaryStats();
      } catch (e) {
        alert(e.message);
      }
    }

    async function fetchTasks() {
      try {
        const data = await apiRequest('/tasks');
        tasks.value = data;
      } catch (e) {
        console.error('获取任务列表失败', e);
      }
    }

    async function addTask() {
      if (!newTaskContent.value.trim()) return;
      try {
        await apiRequest('/tasks', {
          method: 'POST',
          body: JSON.stringify({ content: newTaskContent.value.trim() })
        });
        newTaskContent.value = '';
        fetchTasks();
        fetchSummaryStats();
      } catch (e) {
        alert(e.message);
      }
    }

    async function toggleTaskDone(task) {
      try {
        await apiRequest(`/tasks/${task.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ done: !task.done })
        });
        task.done = !task.done;
      } catch (e) {
        alert(e.message);
      }
    }

    async function deleteTask(taskId) {
      try {
        await apiRequest(`/tasks/${taskId}`, { method: 'DELETE' });
        tasks.value = tasks.value.filter(t => t.id !== taskId);
        fetchSummaryStats();
      } catch (e) {
        alert(e.message);
      }
    }

    function onMonthChange() {
      fetchMonthlyStats();
    }

    async function addDream() {
      if (!newDream.value.content.trim()) {
        alert('请输入梦境内容');
        return;
      }

      try {
        await apiRequest('/dreams', {
          method: 'POST',
          body: JSON.stringify(newDream.value)
        });

        newDream.value = {
          content: '',
          lucidity: 3,
          date: new Date().toISOString().split('T')[0]
        };

        loadData();
      } catch (e) {
        alert(e.message);
      }
    }

    function loadData() {
      fetchDreams();
      fetchMonthlyStats();
      fetchSummaryStats();
      fetchTasks();
    }

    function createWhiteNoise() {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContext();

      const bufferSize = 2 * audioContext.sampleRate;
      const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const output = noiseBuffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      noiseNode = audioContext.createBufferSource();
      noiseNode.buffer = noiseBuffer;
      noiseNode.loop = true;

      gainNode = audioContext.createGain();
      gainNode.gain.value = 0.05;

      const filter = audioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1000;

      noiseNode.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(audioContext.destination);

      noiseNode.start();
    }

    function toggleWhiteNoise() {
      if (isPlaying.value) {
        stopWhiteNoise();
      } else {
        startWhiteNoise();
      }
    }

    function startWhiteNoise() {
      if (!audioContext) {
        createWhiteNoise();
      } else if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      if (gainNode) {
        gainNode.gain.setValueAtTime(0.05, audioContext.currentTime);
      }
      isPlaying.value = true;
    }

    function stopWhiteNoise() {
      if (gainNode && audioContext) {
        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      }
      isPlaying.value = false;
    }

    onMounted(() => {
      loadUser();
      loadSelectedIndicators();
      if (isLoggedIn.value) {
        loadData();
      }
    });

    return {
      isLoggedIn,
      user,
      loginForm,
      loginLoading,
      loginError,
      handleLogin,
      handleLogout,
      dreams,
      randomDream,
      monthlyStats,
      summaryStats,
      newDream,
      fetchRandomDream,
      addDream,
      isPlaying,
      toggleWhiteNoise,
      selectedYear,
      selectedMonth,
      yearOptions,
      onMonthChange,
      statIndicators,
      selectedIndicators,
      showStatsSettings,
      visibleStats,
      toggleIndicator,
      isIndicatorSelected,
      getStatValue,
      toggleFavorite,
      tasks,
      newTaskContent,
      addTask,
      toggleTaskDone,
      deleteTask
    };
  }
}).mount('#app');
