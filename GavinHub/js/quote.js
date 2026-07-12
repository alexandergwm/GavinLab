import { loadSettings } from './storage.js';
import { readString, writeString } from './storage.js';
import { KEYS } from './keys.js';
import { getCachedWeather, getWeatherInfo } from './weather.js';

const USER_NAME = 'Gavin';

/** 时段：早上 5-11，下午 12-17，晚上 18-4（跨午夜） */
function getPeriod(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/** 安全的本地日期键（YYYY-MM-DD），避免 toISOString 的 UTC 偏移 */
function getLocalDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 跨午夜的晚上归属前一日，便于「晚上一次」语义 */
function getGreetDateKey(date = new Date()) {
  const d = new Date(date.getTime());
  if (d.getHours() < 5) {
    d.setDate(d.getDate() - 1);
  }
  return getLocalDateKey(d);
}

function getGreetingStorageKey(date = new Date()) {
  return `${getGreetDateKey(date)}-${getPeriod(date)}`;
}

function loadLastGreetingKey() {
  return readString(KEYS.greetingLast, '');
}

function saveLastGreetingKey(key) {
  writeString(KEYS.greetingLast, key);
}

/** 仅当启用问候 且 当日该时段首次展示时才打招呼 */
function canGreetThisPeriod() {
  const settings = loadSettings();
  if (settings.showGreeting === false) return false;
  const current = getGreetingStorageKey();
  return loadLastGreetingKey() !== current;
}

function markGreetingShown() {
  saveLastGreetingKey(getGreetingStorageKey());
}

function getGreetingText(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return `早上好，${USER_NAME}`;
  if (hour >= 12 && hour < 18) return `下午好，${USER_NAME}`;
  return `晚上好，${USER_NAME}`;
}

const QUOTES = {
  thunder: [
    '窗外雷声隆隆，不妨泡杯茶，把想问的事慢慢理清。',
    '雷阵雨来时，世界会安静片刻——正好适合专注检索。',
    '别被雷声吓到，你远比天气更稳。',
    '雷雨过境，空气会清新；问题查完，思路也会。',
    '「风雨如晦，鸡鸣不已。」—— 今日宜静思、宜求知。',
    'Each storm runs its course. — Zen proverb',
    '雷雨天，适合把好奇心交给搜索框。',
    '电闪雷鸣，不过是天空在敲鼓——你只管前行。',
  ],
  rain: [
    '听雨声，查资料，也是一桩雅事。',
    '雨天路滑，思路不必滑——慢慢搜，总能找到。',
    '「空山新雨后，天气晚来秋。」—— 雨里亦有清趣。',
    '细雨敲窗，正好把未解之惑一一厘清。',
    '雨天的答案，往往藏在多翻几页里。',
    'Some people feel the rain. Others just get wet. — Bob Marley',
    '雨声是最好的白噪音，搜索是最好的雨具。',
    '落雨时分，宜读书，宜检索，宜与自己对话。',
  ],
  snow: [
    '雪落无声，搜索有应。',
    '「晚来天欲雪，能饮一杯无？」—— 今日宜温故知新。',
    '窗外飘雪，窗内求知——各得其乐。',
    '瑞雪兆丰年，好问兆好答。',
    'Snowflakes are one of nature\'s most fragile things, but look what they can do when they stick together.',
  ],
  fog: [
    '雾中看不清路，搜索能帮你拨云见日。',
    '「雾失楼台，月迷津渡。」—— 问一问，便不迷了。',
    '浓雾散去，答案自现——多搜一次试试。',
  ],
  cloudy: [
    '云遮日，心不遮——想查什么，尽管问。',
    '阴天也有光，只是藏在云层后面；答案也是。',
    '「行到水穷处，坐看云起时。」—— 搜一搜，或许柳暗花明。',
    '多云天气，适合多云思考、精准检索。',
  ],
  sunny: [
    '春光灿烂，正好出门——或打开搜索，去更远的地方。',
    '日头正好，心情也该敞亮——有问题，尽管搜。',
    'Keep your face always toward the sunshine—and shadows will fall behind you. — Emerson',
    '晴朗的日子，连问题都显得更明朗了。',
    '阳光满窗，好奇心也该满格。',
    '今日天光甚好，宜探索、宜发现。',
  ],
  hot: [
    '暑气正盛，心静自然凉——先查清楚，再行动。',
    '高温天气，多喝水，多休息，有疑问随时搜。',
    '「心静自然凉。」—— 热浪里，保持一份从容。',
    '热天宜慢，宜静，宜把问题一个个解决。',
  ],
  cold: [
    '天寒地冻，一杯热饮配一次精准搜索，刚刚好。',
    '「晚来天欲雪，能饮一杯无？」—— 冷天更宜温故知新。',
    '寒风凛冽，心里那团好奇的火别灭。',
    'Cold days are perfect for warm thoughts and good questions.',
  ],
  morning: [
    '「一日之计在于晨。」—— 第一个搜索，往往最重要。',
    '早安。今天想先搞懂哪一件事？',
    '清晨的搜索框，像一张空白日程——等你填写。',
    'The morning has gold in its mouth. — Benjamin Franklin',
    '早起的疑问，值得一个清晰的答案。',
  ],
  afternoon: [
    '午后犯困？搜点有趣的东西提提神。',
    '「午后一杯茶，搜索两页书。」',
    '下午时光，适合把上午的疑惑一并解决。',
    'Afternoon is the time when the day begins to breathe.',
  ],
  evening: [
    '「夕阳无限好，只是近黄昏。」—— 趁天色未晚，把问题查完。',
    '傍晚时分，宜复盘、宜检索、宜与自己对话。',
    '一天将尽，未解之惑不妨在此刻清零。',
    'Evening is a time of real and false and beautiful promises.',
  ],
  night: [
    '夜深了，还有搜索框陪你。',
    '「挑灯看剑，梦回吹角连营。」—— 夜读夜搜，别有滋味。',
    'The night is the hardest time to be alive. — Poppy Z. Brite',
    '万籁俱寂，正好专注地找答案。',
    '深夜的搜索，往往指向内心真正在意的事。',
  ],
  weekend: [
    '周末愉快——今天想探索点什么？',
    '「休息是为了走更长的路。」—— 顺便把好奇也满足一下。',
    'Weekend: when you finally have time for the questions you saved all week.',
    '周末的搜索，不必为工作，可以为兴趣。',
  ],
  weekday: [
    '工作日里，高效检索就是省时间。',
    '「工欲善其事，必先利其器。」—— 搜索也是利器之一。',
    '忙里偷闲查一查，问题不过夜。',
  ],
  default: [
    '有问题，搜一搜；有好奇，追一追。',
    '「学然后知不足，教然后知困。」—— 搜索是学习的起点。',
    'The important thing is not to stop questioning. — Einstein',
    '每一次搜索，都是一次小小的冒险。',
    '答案不会自己走来，但搜索框永远在这里。',
    '「知之者不如好之者，好之者不如乐之者。」',
    'Stay curious.',
  ],
  map: [
    '搜一搜附近有趣的地方，周末不虚度。',
    '好店藏在巷子里，地图带你找到。',
    '远方不远，搜一下就在脚下。',
    '换条路走走，也许会发现新的风景。',
    '周末出游，从输入一个地名开始。',
    '地图上每一个标点，都藏着一个故事。',
    '不知道去哪？让地图帮你做决定。',
    '探索周边，比刷手机更有意思。',
  ],
  ai: [
    '把好奇交给 AI，把答案留给自己验证。',
    '好问题，值得多问几个角度。',
    'AI 是起点，思考才是终点。',
    '不懂就问，AI 不会嫌你烦。',
    '每一个「为什么」，都值得被认真回答。',
    '让 AI 帮你搭框架，细节由你来填。',
    '提问的艺术，从第一个字开始。',
    'AI 不会嘲笑你的问题，只会尽力回答。',
  ],
  xhs: [
    '种草之前，先搜一搜真实体验。',
    '生活方式，藏在小红书的笔记里。',
    '好看的攻略，都是搜出来的。',
    '别人的避坑指南，就是你的省钱秘籍。',
    '灵感往往来自一次随手搜索。',
    '找好去处、好物、好做法——从这里开始。',
    '真实分享比广告更靠谱，先搜再看。',
    '生活的答案，往往藏在别人的经验里。',
  ],
  gh: [
    '好项目值得 star，好代码值得搜。',
    '站在巨人的肩膀上，从搜索仓库开始。',
    'Bug 难解？也许有人已经 issue 过了。',
    '开源世界，搜索是最好的入场券。',
    '优秀的代码，值得一读再读。',
    'fork 之前，先了解它。',
    '开发者的时间很宝贵，精准搜索是省时之道。',
    'GitHub 上，每一行代码都在等人发现。',
  ],
  zh: [
    '知乎上总有人问过你想问的问题。',
    '观点碰撞的地方，答案往往更丰富。',
    '一个问题，十种见解——这就是知乎。',
    '专业的人回答专业的事，搜一下就知道。',
    '深度好文，值得你用关键词找到。',
    '困惑不丢人，搜一搜就清晰了。',
    '知之为知之，搜索使之。',
    '在知乎，没有愚蠢的问题，只有还没被搜到的问题。',
  ],
};

const MODE_QUOTE_MODES = new Set(['map', 'ai', 'xhs', 'gh', 'zh']);

/** 丰富多样的日常语录（非搜索主导），按时段略有侧重，简洁自然 */
const VARIED = {
  morning: [
    '新的一天，从一个温柔的问题开始。',
    '早安，愿你的好奇被世界温柔回应。',
    '清晨的头脑像一张白纸，适合写下一个好问题。',
    '喝一口水，把今天第一个念头问出口。',
    '太阳刚起，心也该亮一点。',
    '早起的人，问题也醒得早。',
    '晨光正好，适合把第一份好奇心兑现。',
    '把窗帘拉开，也把思路拉开。',
  ],
  afternoon: [
    '午后光线柔和，思路也适合慢一点。',
    '泡一杯茶，把上午的疑惑再看一遍。',
    '下午的窗，适合把灵感放进去晾一晾。',
    '别急，答案正在来的路上。',
    '喝水，伸展，换个角度再想想。',
    '午后的困意，常常被一个好问题冲散。',
    '把节奏放慢，世界会把细节还给你。',
  ],
  evening: [
    '夕阳西下，问题也可以收一收。',
    '夜色来临，允许自己只问，不必立刻答。',
    '一天的尾巴，留给那些温柔的念头。',
    '复盘，也复盘今天的好奇。',
    '晚风轻，疑问轻放。',
    '天黑了，心却不必。',
    '把今天没想通的，交给明天清晨。',
  ],
  general: [
    '生活值得被多问几次。',
    '答案藏在你还没问出口的那句话里。',
    '保持提问，比保持正确更重要。',
    '小小的一个为什么，能打开很大的世界。',
    '好奇心是不会过期的通行证。',
    '停下来问问自己，其实也是一种前进。',
    '有些事，搜一搜就豁然；有些事，慢慢想就好了。',
    '知识像云，会流动，也会下雨。',
    '允许自己今天什么都不懂，只要肯问。',
    '每一次输入，都是和世界的一次对话。',
    '问题比答案更诚实。',
    '别怕问蠢问题，蠢问题往往最有意思。',
    '灵感喜欢被安静地邀请。',
    '今天也请对自己温柔一点。',
    '世界很大，但你的问题可以更具体。',
    '问得越清楚，世界回得越温柔。',
    '把疑问写下来，它就不再飘着了。',
    '思考像散步，不必直奔终点。',
    '偶尔发呆，也是大脑在整理文件夹。',
    '你值得拥有那些让你眼睛发亮的答案。',
    '把心事摊开，风会帮你拣走一部分。',
    '没灵感的时候，往往只是缺了一杯水。',
  ],
};

/** 偶尔出现的搜索小贴士（约 20-30% 出现） */
const SEARCH_TIPS = [
  '按 Tab 可切换 AI、地图等搜索模式。',
  '普通模式输入「ai」再按 Tab 即可进入 AI 提问。',
  '输入「gh xxx」可快速搜索 GitHub 项目。',
  '直接输入网址会自动识别跳转。',
  '金额后加货币代码可快速换算汇率。',
  '搜索建议出现时可用方向键和回车选择。',
  '按 / 键可随时把光标拉回搜索框。',
  'Alt + 数字键能在模式菜单里快速切换。',
  '按 Esc 退出特殊搜索模式或收起建议。',
];

function getTimeCategory() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 14) return 'noon';
  if (hour >= 14 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

function getWeatherCategory() {
  const data = getCachedWeather();
  if (!data?.current) return null;

  const { weather_code: code, temperature_2m: temp } = data.current;
  const { icon } = getWeatherInfo(code);

  if (icon === 'thunder') return 'thunder';
  if (icon === 'rain' || icon === 'drizzle') return 'rain';
  if (icon === 'snow') return 'snow';
  if (icon === 'fog') return 'fog';
  if (icon === 'cloud' || icon === 'overcast' || icon === 'sun-cloud') return 'cloudy';
  if (icon === 'sun') return 'sunny';
  if (temp >= 33) return 'hot';
  if (temp <= 5) return 'cold';
  return null;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function collectQuotePool() {
  // 保留天气与模式相关的氛围语录；日常默认走丰富池
  const pool = [];
  const weather = getWeatherCategory();
  if (weather && QUOTES[weather]) pool.push(...QUOTES[weather]);
  // 轻量混入少量旧时段短句（不作为主力）
  const time = getTimeCategory();
  if (time === 'noon' && QUOTES.afternoon) pool.push(...QUOTES.afternoon);
  else if (QUOTES[time]) pool.push(...QUOTES[time].slice(0, 2));
  return pool.length ? pool : [];
}

function pickVariedQuote() {
  const period = getPeriod();
  let pool = [...(VARIED.general || [])];
  if (VARIED[period]) pool = pool.concat(VARIED[period]);
  // 天气氛围偶尔加入（不强推搜索）
  const weatherPool = collectQuotePool();
  if (weatherPool.length && Math.random() < 0.35) {
    pool = pool.concat(weatherPool);
  }
  return pickRandom(pool.length ? pool : VARIED.general);
}

function pickMixedNormalQuote() {
  // 控制搜索提示占比约 20-30%，其余为丰富日常内容
  if (SEARCH_TIPS.length && Math.random() < 0.27) {
    return pickRandom(SEARCH_TIPS);
  }
  return pickVariedQuote();
}

function getBaseQuote(searchMode = 'normal') {
  if (MODE_QUOTE_MODES.has(searchMode) && QUOTES[searchMode]?.length) {
    return pickRandom(QUOTES[searchMode]);
  }
  // 普通模式使用丰富混合池
  const weatherOrLegacy = collectQuotePool();
  if (weatherOrLegacy.length && Math.random() < 0.18) {
    return pickRandom(weatherOrLegacy);
  }
  return pickMixedNormalQuote();
}

function resolveQuoteDisplay(searchMode = 'normal') {
  const quote = getBaseQuote(searchMode);
  if (!canGreetThisPeriod()) {
    return { text: quote, greetingOnly: false };
  }
  // 当日该时段首次：打招呼，并记录，避免重复
  markGreetingShown();
  const greeting = getGreetingText();
  // 首次问候时，更倾向带上丰富语录（但保留少量纯问候）
  if (Math.random() < 0.38) {
    return { text: greeting, greetingOnly: true };
  }
  return { text: `${greeting}，${quote}`, greetingOnly: false };
}

export function getContextualQuote(searchMode = 'normal') {
  return getBaseQuote(searchMode);
}

export function initSearchQuote(quoteEl) {
  if (!quoteEl) return { show: () => {}, hide: () => {}, hideImmediate: () => {} };

  let stateGen = 0;

  function show(searchMode = 'normal') {
    stateGen += 1;
    const gen = stateGen;
    const { text, greetingOnly } = resolveQuoteDisplay(searchMode);
    quoteEl.textContent = text;
    quoteEl.classList.toggle('search-quote--greeting-only', greetingOnly);
    quoteEl.hidden = false;
    requestAnimationFrame(() => {
      if (gen !== stateGen) return;
      quoteEl.classList.add('visible');
    });
  }

  function hideImmediate() {
    stateGen += 1;
    quoteEl.classList.remove('visible', 'search-quote--greeting-only');
    quoteEl.hidden = true;
  }

  function hide() {
    stateGen += 1;
    const gen = stateGen;
    quoteEl.classList.remove('visible', 'search-quote--greeting-only');
    const finishHide = () => {
      if (gen !== stateGen) return;
      quoteEl.hidden = true;
    };
    const onEnd = (e) => {
      if (e.target !== quoteEl || e.propertyName !== 'opacity') return;
      quoteEl.removeEventListener('transitionend', onEnd);
      finishHide();
    };
    quoteEl.addEventListener('transitionend', onEnd);
    setTimeout(finishHide, 320);
  }

  return { show, hide, hideImmediate };
}
