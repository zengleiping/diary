// 內建貼紙（全部是原創的簡單 SVG 圖案）
const O = 'stroke="#fff" stroke-width="6" paint-order="stroke" stroke-linejoin="round"';
const L = 'stroke="#3b3036" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"';

const RAW = {
  heart: `<path ${O} fill="#ff7b9c" d="M50 86 C18 64 8 46 14 30 C20 14 42 12 50 30 C58 12 80 14 86 30 C92 46 82 64 50 86Z"/><ellipse cx="30" cy="32" rx="6" ry="4" fill="#fff" opacity=".6"/>`,
  star: `<path ${O} fill="#ffd45e" d="M50 8 L61 36 L91 38 L68 57 L76 87 L50 70 L24 87 L32 57 L9 38 L39 36Z"/><circle cx="42" cy="50" r="3" fill="#3b3036"/><circle cx="58" cy="50" r="3" fill="#3b3036"/><path ${L} d="M45 58 Q50 62 55 58"/>`,
  cloud: `<path ${O} fill="#e8f4ff" d="M24 74 C8 74 8 52 24 50 C22 32 44 24 54 38 C62 26 84 32 80 50 C96 52 94 74 78 74Z"/><circle cx="42" cy="58" r="3" fill="#3b3036"/><circle cx="62" cy="58" r="3" fill="#3b3036"/><ellipse cx="36" cy="64" rx="4" ry="2.5" fill="#ffb3c6"/><ellipse cx="68" cy="64" rx="4" ry="2.5" fill="#ffb3c6"/>`,
  sun: `<g ${O}><circle cx="50" cy="50" r="24" fill="#ffb84d"/></g><g stroke="#ffb84d" stroke-width="6" stroke-linecap="round"><path d="M50 8v10M50 82v10M8 50h10M82 50h10M20 20l7 7M73 73l7 7M80 20l-7 7M27 73l-7 7"/></g><circle cx="42" cy="48" r="3" fill="#3b3036"/><circle cx="58" cy="48" r="3" fill="#3b3036"/><path ${L} d="M44 57 Q50 62 56 57"/>`,
  flower: `<g ${O} fill="#ffa6c9"><circle cx="50" cy="26" r="16"/><circle cx="73" cy="44" r="16"/><circle cx="64" cy="71" r="16"/><circle cx="36" cy="71" r="16"/><circle cx="27" cy="44" r="16"/></g><circle cx="50" cy="52" r="13" fill="#ffe27a"/>`,
  leaf: `<path ${O} fill="#8fd18a" d="M20 82 C20 40 44 16 84 14 C84 56 60 82 20 82Z"/><path d="M24 78 L70 30" stroke="#5aa855" stroke-width="3" fill="none"/>`,
  plane: `<path ${O} fill="#7cc3ff" d="M10 52 L88 20 Q96 18 92 26 L62 88 L50 60Z"/><path d="M50 60 L88 22" stroke="#4a9be0" stroke-width="3"/>`,
  camera: `<rect ${O} x="10" y="30" width="80" height="54" rx="10" fill="#8a7cff"/><rect x="34" y="20" width="24" height="14" rx="4" fill="#8a7cff"/><circle cx="50" cy="57" r="17" fill="#fff"/><circle cx="50" cy="57" r="10" fill="#3b3036"/><circle cx="46" cy="53" r="3" fill="#fff"/><rect x="72" y="38" width="10" height="6" rx="2" fill="#ffe27a"/>`,
  coffee: `<path ${O} fill="#fff4e6" d="M18 36 H72 V70 Q72 88 54 88 H36 Q18 88 18 70Z"/><path d="M72 44 Q90 44 88 58 Q86 70 72 68" stroke="#3b3036" stroke-width="5" fill="none"/><path d="M18 36 H72 V46 H18Z" fill="#a0694b"/><path ${L} d="M36 26 Q30 18 36 10M52 26 Q46 18 52 10"/><circle cx="36" cy="62" r="3" fill="#3b3036"/><circle cx="54" cy="62" r="3" fill="#3b3036"/>`,
  cat: `<path ${O} fill="#ffcf8a" d="M18 86 Q12 48 22 30 L20 10 L38 24 Q50 20 62 24 L80 10 L78 30 Q88 48 82 86Z"/><circle cx="38" cy="52" r="4" fill="#3b3036"/><circle cx="62" cy="52" r="4" fill="#3b3036"/><path ${L} d="M44 62 Q50 67 56 62M50 58v4"/><ellipse cx="30" cy="62" rx="5" ry="3" fill="#ff9fb4"/><ellipse cx="70" cy="62" rx="5" ry="3" fill="#ff9fb4"/>`,
  suitcase: `<rect ${O} x="14" y="30" width="72" height="54" rx="8" fill="#ff8a65"/><path d="M38 30 V20 Q38 14 44 14 H56 Q62 14 62 20 V30" stroke="#3b3036" stroke-width="5" fill="none"/><rect x="14" y="50" width="72" height="8" fill="#ffd45e"/><circle cx="30" cy="42" r="5" fill="#fff"/><rect x="58" y="66" width="18" height="10" rx="2" fill="#fff"/>`,
  pin: `<path ${O} fill="#ff5d73" d="M50 92 C30 64 18 52 18 36 A32 32 0 0 1 82 36 C82 52 70 64 50 92Z"/><circle cx="50" cy="36" r="12" fill="#fff"/>`,
  rainbow: `<g fill="none" stroke-linecap="round"><path d="M12 76 A38 38 0 0 1 88 76" stroke="#fff" stroke-width="34"/><path d="M16 76 A34 34 0 0 1 84 76" stroke="#ff7b7b" stroke-width="8"/><path d="M24 76 A26 26 0 0 1 76 76" stroke="#ffd45e" stroke-width="8"/><path d="M32 76 A18 18 0 0 1 68 76" stroke="#7cc3ff" stroke-width="8"/></g>`,
  ticket: `<path ${O} fill="#ffe27a" d="M8 30 H92 V44 Q84 50 92 56 V70 H8 V56 Q16 50 8 44Z"/><path d="M68 30 V70" stroke="#3b3036" stroke-width="2" stroke-dasharray="4 4"/><text x="38" y="56" font-size="14" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#3b3036">TICKET</text>`,
  onigiri: `<path ${O} fill="#fff" d="M50 12 Q60 12 80 52 Q92 80 70 86 H30 Q8 80 20 52 Q40 12 50 12Z"/><rect x="34" y="60" width="32" height="26" fill="#2f4f3a"/><circle cx="42" cy="46" r="3" fill="#3b3036"/><circle cx="58" cy="46" r="3" fill="#3b3036"/><path ${L} d="M46 53 Q50 56 54 53"/>`,
  bubble: `<path ${O} fill="#fff" d="M14 20 H86 Q92 20 92 26 V62 Q92 68 86 68 H40 L24 84 L28 68 H14 Q8 68 8 62 V26 Q8 20 14 20Z"/><path d="M8 26 Q8 20 14 20 H86 Q92 20 92 26 V62 Q92 68 86 68 H40 L24 84 L28 68 H14 Q8 68 8 62Z" fill="none" stroke="#3b3036" stroke-width="2.5"/>`,
  ribbon: `<path ${O} fill="#ff8fb1" d="M50 46 L14 24 V68Z M50 46 L86 24 V68Z"/><circle cx="50" cy="46" r="10" fill="#ff5d8f"/><path d="M44 54 L34 88 M56 54 L66 88" stroke="#ff5d8f" stroke-width="7" stroke-linecap="round"/>`,
  moon: `<path ${O} fill="#ffe89a" d="M62 10 A40 40 0 1 0 90 66 A32 32 0 1 1 62 10Z"/><circle cx="40" cy="52" r="3" fill="#3b3036"/><path ${L} d="M44 64 Q48 67 52 64"/>`,
  paw: `<g ${O} fill="#c79bff"><ellipse cx="50" cy="64" rx="22" ry="18"/><circle cx="24" cy="40" r="9"/><circle cx="40" cy="26" r="9"/><circle cx="60" cy="26" r="9"/><circle cx="76" cy="40" r="9"/></g>`,
  check: `<circle ${O} cx="50" cy="50" r="38" fill="#8fd18a"/><path d="M32 52 L45 64 L70 38" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
};

export const BUILTIN_STICKERS = Object.entries(RAW).map(([id, body]) => ({
  id: 'b-' + id,
  src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`),
}));

export const EMOJI_GROUPS = {
  '心情': '😊😆🥰😴😭😤🤔😎🥳🤒😋🙃'.match(/./gu),
  '旅行': '✈️🚄🚌🗺️🏝️⛰️🏯🗼🎡📷🧳🎫'.match(/\p{Extended_Pictographic}️?/gu),
  '食物': '🍜🍣🍰🧋☕🍓🍙🥐🍦🍺🥟🍱'.match(/./gu),
  '天氣': '☀️⛅🌧️⛈️❄️🌈🌙⭐🌸🍁🌊🔥'.match(/\p{Extended_Pictographic}️?/gu),
  '裝飾': '💖✨🎀🌟💌📌🖍️🎈🍀🦋🐾💯'.match(/\p{Extended_Pictographic}️?/gu),
};

export const TAPES = [
  { id: 'pink-stripe', label: '粉條紋', a: '#ffc9d9', b: '#fff0f5', pattern: 'stripe' },
  { id: 'mint-dot', label: '薄荷點點', a: '#bdeedd', b: '#ffffff', pattern: 'dot' },
  { id: 'yellow-grid', label: '黃格子', a: '#ffe79a', b: '#fff8d6', pattern: 'grid' },
  { id: 'blue-plain', label: '天空藍', a: '#b8dcff', b: '#b8dcff', pattern: 'plain' },
  { id: 'lilac-stripe', label: '紫條紋', a: '#d9c8ff', b: '#f4efff', pattern: 'stripe' },
  { id: 'kraft', label: '牛皮紙', a: '#d9b98c', b: '#e7cfa8', pattern: 'dot' },
];

export const PAPERS = [
  { id: 'plain', label: '空白' },
  { id: 'lines', label: '橫線' },
  { id: 'grid', label: '方格' },
  { id: 'dots', label: '點點' },
  { id: 'kraft', label: '牛皮紙' },
  { id: 'pink', label: '粉紅' },
];

export const PROMPTS = [
  '今天吃到最好吃的是什麼？',
  '今天有誰讓你笑了？',
  '用三個詞形容今天',
  '今天學到一件小事',
  '如果今天有配樂，會是哪首歌？',
  '今天最想感謝的人或事',
  '今天拍的一張照片，說說它的故事',
  '明天想做的一件小事',
  '今天的天氣和心情像嗎？',
  '今天花最多時間在什麼上？',
  '最近想去哪裡玩？',
  '今天有什麼值得收藏的小東西（票根、收據、包裝）？',
];

export const MOODS = ['😊', '🥰', '😆', '😌', '😴', '😐', '😢', '😤', '🤒'];
