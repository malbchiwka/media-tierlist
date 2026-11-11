/**
 * Media Tierlist - Presets & Starter Pack
 * Curated collection of top Anime and Movies with metadata and local/CDN poster URLs.
 */

// Minimal, clean SVG fallback generator for offline or broken poster URLs
function createPosterSVG(title, type, color = '#e11d48') {
  const isAnime = type === 'anime';
  const icon = isAnime ? '🎌' : '🎬';
  const badgeText = isAnime ? 'АНИМЕ' : 'ФИЛЬМ';
  const cleanTitle = (title || 'Тайтл').replace(/[<>&"]/g, '');
  
  // Split title nicely into two lines if long
  let line1 = cleanTitle;
  let line2 = '';
  if (cleanTitle.length > 18) {
    const mid = cleanTitle.lastIndexOf(' ', 18);
    if (mid > 0) {
      line1 = cleanTitle.substring(0, mid);
      line2 = cleanTitle.substring(mid + 1);
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="300" height="450">
    <rect width="100%" height="100%" fill="#18181b"/>
    <rect x="8" y="8" width="284" height="434" rx="6" fill="#121214" stroke="#27272a" stroke-width="1.5"/>
    
    <!-- Minimal center badge -->
    <rect x="110" y="130" width="80" height="80" rx="10" fill="#27272a" stroke="#3f3f46" stroke-width="1"/>
    <text x="150" y="182" font-size="40" text-anchor="middle" font-family="sans-serif">${icon}</text>
    
    <!-- Type Pill -->
    <rect x="100" y="234" width="100" height="22" rx="4" fill="#27272a" stroke="#3f3f46" stroke-width="1"/>
    <text x="150" y="249" font-size="11" font-weight="600" fill="#e4e4e7" text-anchor="middle" font-family="'Inter', -apple-system, sans-serif" letter-spacing="1">${badgeText}</text>
    
    <!-- Title text lines -->
    <text x="150" y="305" font-size="16" font-weight="600" fill="#f4f4f5" text-anchor="middle" font-family="'Inter', -apple-system, sans-serif">${line1}</text>
    ${line2 ? `<text x="150" y="330" font-size="13" font-weight="400" fill="#a1a1aa" text-anchor="middle" font-family="'Inter', -apple-system, sans-serif">${line2}</text>` : ''}
    
    <!-- Subtle accent bottom line -->
    <rect x="130" y="380" width="40" height="2" rx="1" fill="${color}"/>
  </svg>`;

  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const STARTER_ANIME = [
  {
    id: 'anime-aot',
    title: 'Атака Титанов (Attack on Titan)',
    originalTitle: 'Shingeki no Kyojin',
    type: 'anime',
    year: '2013-2023',
    duration: '89 эп.',
    rating: '9.0',
    poster: 'assets/posters/anime-aot.jpg',
    cdnPoster: 'https://media.kitsu.app/anime/poster_images/7442/medium.jpg',
    fallbackPoster: createPosterSVG('Атака Титанов', 'anime', '#e02444'),
    synopsis: 'Человечество живет в городах, окруженных колоссальными стенами от гигантских титанов-людоедов.'
  },
  {
    id: 'anime-death-note',
    title: 'Тетрадь Смерти (Death Note)',
    originalTitle: 'Death Note',
    type: 'anime',
    year: '2006',
    duration: '37 эп.',
    rating: '8.9',
    poster: 'assets/posters/anime-death-note.jpg',
    cdnPoster: 'https://media.kitsu.app/anime/poster_images/1376/medium.jpg',
    fallbackPoster: createPosterSVG('Тетрадь Смерти', 'anime', '#b80c29'),
    synopsis: 'Гениальный старшеклассник Лайт Ягами находит мистическую тетрадь бога смерти Рюка.'
  },
  {
    id: 'anime-spirited-away',
    title: 'Унесённые призраками',
    originalTitle: 'Sen to Chihiro no Kamikakushi',
    type: 'anime',
    year: '2001',
    duration: '125 мин',
    rating: '8.6',
    poster: 'assets/posters/anime-spirited-away.jpg',
    cdnPoster: 'https://media.kitsu.app/anime/poster_images/145/medium.jpg',
    fallbackPoster: createPosterSVG('Унесённые призраками', 'anime', '#e02444'),
    synopsis: 'Шедевр Хаяо Миядзаки о девочке Тихиро, попавшей в волшебный мир духов.'
  },
  {
    id: 'anime-demon-slayer',
    title: 'Клинок, рассекающий демонов',
    originalTitle: 'Kimetsu no Yaiba',
    type: 'anime',
    year: '2019-2024',
    duration: '55+ эп.',
    rating: '8.7',
    poster: 'assets/posters/anime-demon-slayer.jpg',
    cdnPoster: 'https://media.kitsu.app/anime/poster_images/41370/medium.jpg',
    fallbackPoster: createPosterSVG('Клинок рассекающий демонов', 'anime', '#ff2b56'),
    synopsis: 'Тандзиро Камадо становится истребителем демонов, чтобы спасти свою сестру Незуко.'
  },
  {
    id: 'anime-jujutsu-kaisen',
    title: 'Магическая битва (Jujutsu Kaisen)',
    originalTitle: 'Jujutsu Kaisen',
    type: 'anime',
    year: '2020-2023',
    duration: '47 эп.',
    rating: '8.6',
    poster: 'assets/posters/anime-jujutsu-kaisen.jpg',
    cdnPoster: 'https://media.kitsu.app/anime/poster_images/42765/medium.jpg',
    fallbackPoster: createPosterSVG('Магическая битва', 'anime', '#d90429'),
    synopsis: 'Юдзи Итадори проглатывает палец древнего демона Сукуны и вступает в мир проклятий.'
  },
  {
    id: 'anime-your-name',
    title: 'Твоё имя (Your Name)',
    originalTitle: 'Kimi no Na wa.',
    type: 'anime',
    year: '2016',
    duration: '107 мин',
    rating: '8.8',
    poster: 'assets/posters/anime-your-name.jpg',
    cdnPoster: 'https://media.kitsu.app/anime/poster_images/11614/medium.jpg',
    fallbackPoster: createPosterSVG('Твоё имя', 'anime', '#ff4d6d'),
    synopsis: 'Романтическая драма Макото Синкая о двух подростках, загадочно меняющихся телами.'
  },
  {
    id: 'anime-chainsaw-man',
    title: 'Человек-бензопила (Chainsaw Man)',
    originalTitle: 'Chainsaw Man',
    type: 'anime',
    year: '2022',
    duration: '12 эп.',
    rating: '8.5',
    poster: 'assets/posters/anime-chainsaw-man.jpg',
    cdnPoster: 'https://media.kitsu.app/anime/poster_images/43806/medium.jpg',
    fallbackPoster: createPosterSVG('Человек-бензопила', 'anime', '#ef233c'),
    synopsis: 'Дэндзи возрождается полудемоном с бензопилами вместо конечностей.'
  },
  {
    id: 'anime-evangelion',
    title: 'Евангелион (Neon Genesis Evangelion)',
    originalTitle: 'Shin Seiki Evangelion',
    type: 'anime',
    year: '1995',
    duration: '26 эп.',
    rating: '8.5',
    poster: 'assets/posters/anime-evangelion.jpg',
    cdnPoster: 'https://media.kitsu.app/anime/poster_images/409/medium.jpg',
    fallbackPoster: createPosterSVG('Евангелион', 'anime', '#9d0208'),
    synopsis: 'Культовая психологическая драма Хидэаки Анно о гигантских биороботах и Ангелах.'
  },
  {
    id: 'anime-fma-brotherhood',
    title: 'Стальной алхимик: Братство',
    originalTitle: 'Fullmetal Alchemist: Brotherhood',
    type: 'anime',
    year: '2009',
    duration: '64 эп.',
    rating: '9.1',
    poster: 'assets/posters/anime-fma-brotherhood.jpg',
    cdnPoster: 'https://media.kitsu.app/anime/poster_images/3936/medium.jpg',
    fallbackPoster: createPosterSVG('Стальной алхимик', 'anime', '#c9184a'),
    synopsis: 'Братья Элрики ищут философский камень, чтобы вернуть свои тела после запретной алхимии.'
  },
  {
    id: 'anime-cyberpunk',
    title: 'Киберпанк: Бегущие по краю',
    originalTitle: 'Cyberpunk: Edgerunners',
    type: 'anime',
    year: '2022',
    duration: '10 эп.',
    rating: '8.6',
    poster: 'assets/posters/anime-cyberpunk.jpg',
    cdnPoster: 'https://media.kitsu.app/anime/poster_images/43637/medium.jpg',
    fallbackPoster: createPosterSVG('Cyberpunk: Edgerunners', 'anime', '#ff0054'),
    synopsis: 'Взрывная история студии Trigger в мире Night City.'
  }
];

const STARTER_MOVIES = [
  {
    id: 'movie-interstellar',
    title: 'Интерстеллар (Interstellar)',
    originalTitle: 'Interstellar',
    type: 'movie',
    year: '2014',
    duration: '169 мин',
    rating: '8.7',
    poster: 'assets/posters/movie-interstellar.jpg',
    cdnPoster: 'https://m.media-amazon.com/images/M/MV5BYzdjMDAxZGItMjI2My00ODA1LTlkNzItOWFjMDU5ZDJlYWY3XkEyXkFqcGc@._V1_SX300.jpg',
    fallbackPoster: createPosterSVG('Интерстеллар', 'movie', '#e02444'),
    synopsis: 'Команда исследователей отправляется сквозь червоточину в поисках нового дома для человечества.'
  },
  {
    id: 'movie-inception',
    title: 'Начало (Inception)',
    originalTitle: 'Inception',
    type: 'movie',
    year: '2010',
    duration: '148 мин',
    rating: '8.8',
    poster: 'assets/posters/movie-inception.jpg',
    cdnPoster: 'https://m.media-amazon.com/images/M/MV5BMjAxMzY3NjcxNF5BMl5BanBnXkFtZTcwNTI5OTM0Mw@@._V1_SX300.jpg',
    fallbackPoster: createPosterSVG('Начало', 'movie', '#ff2b56'),
    synopsis: 'Вор, способный проникать в чужие сны, берется за сложнейшую миссию — внедрение идеи.'
  },
  {
    id: 'movie-dark-knight',
    title: 'Тёмный рыцарь (The Dark Knight)',
    originalTitle: 'The Dark Knight',
    type: 'movie',
    year: '2008',
    duration: '152 мин',
    rating: '9.0',
    poster: 'assets/posters/movie-dark-knight.jpg',
    cdnPoster: 'https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_SX300.jpg',
    fallbackPoster: createPosterSVG('Тёмный рыцарь', 'movie', '#9b112c'),
    synopsis: 'Бэтмен сталкивается с хаосом, порожденным гением Джокера в исполнении Хита Леджера.'
  },
  {
    id: 'movie-fight-club',
    title: 'Бойцовский клуб (Fight Club)',
    originalTitle: 'Fight Club',
    type: 'movie',
    year: '1999',
    duration: '139 мин',
    rating: '8.8',
    poster: 'assets/posters/movie-fight-club.jpg',
    cdnPoster: 'https://m.media-amazon.com/images/M/MV5BOTgyOGQ1NDItNGU3Ny00MjU3LTg2YWEtNmEyYjBiMjI1Y2M5XkEyXkFqcGc@._V1_SX300.jpg',
    fallbackPoster: createPosterSVG('Бойцовский клуб', 'movie', '#c9184a'),
    synopsis: 'Бессонный клерк встречает харизматичного продавца мыла Тайлера Дёрдена.'
  },
  {
    id: 'movie-matrix',
    title: 'Матрица (The Matrix)',
    originalTitle: 'The Matrix',
    type: 'movie',
    year: '1999',
    duration: '136 мин',
    rating: '8.7',
    poster: 'assets/posters/movie-matrix.jpg',
    cdnPoster: 'https://m.media-amazon.com/images/M/MV5BN2NmN2VhMTQtMDNiOS00NDlhLTliMjgtODE2ZTY0ODQyNDRhXkEyXkFqcGc@._V1_SX300.jpg',
    fallbackPoster: createPosterSVG('Матрица', 'movie', '#7209b7'),
    synopsis: 'Хакер Нео узнает правду об иллюзорности окружающего мира и восстании машин.'
  },
  {
    id: 'movie-dune',
    title: 'Дюна: Часть вторая (Dune: Part Two)',
    originalTitle: 'Dune: Part Two',
    type: 'movie',
    year: '2024',
    duration: '166 мин',
    rating: '8.6',
    poster: 'assets/posters/movie-dune.jpg',
    cdnPoster: 'https://m.media-amazon.com/images/M/MV5BNTc0YmQxMjEtODI5MC00NjFiLTlkMWUtOGQ5NjFmYWUyZGJhXkEyXkFqcGc@._V1_SX300.jpg',
    fallbackPoster: createPosterSVG('Дюна 2', 'movie', '#d90429'),
    synopsis: 'Пол Атрейдес объединяется с фременами, чтобы отомстить заговорщикам на пустынном Арракисе.'
  },
  {
    id: 'movie-pulp-fiction',
    title: 'Криминальное чтиво (Pulp Fiction)',
    originalTitle: 'Pulp Fiction',
    type: 'movie',
    year: '1994',
    duration: '154 мин',
    rating: '8.9',
    poster: 'assets/posters/movie-pulp-fiction.jpg',
    cdnPoster: 'https://m.media-amazon.com/images/M/MV5BYTViYTE3ZGQtNDBlMC00ZTAyLTkyODMtZGRiZDg0MjA2YThkXkEyXkFqcGc@._V1_SX300.jpg',
    fallbackPoster: createPosterSVG('Криминальное чтиво', 'movie', '#b80c29'),
    synopsis: 'Культовые переплетенные истории бандитов Винсента Веги и Джулса Виннфилда от Квентина Тарантино.'
  },
  {
    id: 'movie-oppenheimer',
    title: 'Оппенгеймер (Oppenheimer)',
    originalTitle: 'Oppenheimer',
    type: 'movie',
    year: '2023',
    duration: '180 мин',
    rating: '8.9',
    poster: 'assets/posters/movie-oppenheimer.jpg',
    cdnPoster: 'https://m.media-amazon.com/images/M/MV5BN2JkMDc5MGQtZjg3YS00NmFiLWIyZmQtZTJmNTM5MjVmYTQ4XkEyXkFqcGc@._V1_SX300.jpg',
    fallbackPoster: createPosterSVG('Оппенгеймер', 'movie', '#a4161a'),
    synopsis: 'История физика Роберта Оппенгеймера и создания первого ядерного оружия в рамках Манхэттенского проекта.'
  },
  {
    id: 'movie-green-mile',
    title: 'Зелёная миля (The Green Mile)',
    originalTitle: 'The Green Mile',
    type: 'movie',
    year: '1999',
    duration: '189 мин',
    rating: '8.6',
    poster: 'assets/posters/movie-green-mile.jpg',
    cdnPoster: 'https://m.media-amazon.com/images/M/MV5BMTUxMzQyNjA5MF5BMl5BanBnXkFtZTYwOTU2NTY3._V1_SX300.jpg',
    fallbackPoster: createPosterSVG('Зелёная миля', 'movie', '#660708'),
    synopsis: 'Надзиратель блока смертников знакомится с гигантом Джоном Коффи, обладающим даром исцеления.'
  },
  {
    id: 'movie-blade-runner-2049',
    title: 'Бегущий по лезвию 2049',
    originalTitle: 'Blade Runner 2049',
    type: 'movie',
    year: '2017',
    duration: '164 мин',
    rating: '8.0',
    poster: 'assets/posters/movie-blade-runner-2049.jpg',
    cdnPoster: 'https://m.media-amazon.com/images/M/MV5BNzA1Njg4NzYxOV5BMl5BanBnXkFtZTgwODk5NjU3MzI@._V1_SX300.jpg',
    fallbackPoster: createPosterSVG('Бегущий по лезвию 2049', 'movie', '#ff4d6d'),
    synopsis: 'Офицер К раскапывает давно похороненную тайну, которая может погрузить остатки общества в хаос.'
  }
];

const DEFAULT_TIERS = [
  { id: 'tier-s-plus', name: 'S+', color: '#e11d48', items: ['anime-aot', 'movie-interstellar'] },
  { id: 'tier-s', name: 'S', color: '#be123c', items: ['anime-death-note', 'movie-inception', 'movie-dark-knight'] },
  { id: 'tier-a', name: 'A', color: '#9f1239', items: ['anime-spirited-away', 'anime-demon-slayer', 'movie-matrix'] },
  { id: 'tier-b', name: 'B', color: '#881337', items: ['anime-jujutsu-kaisen', 'movie-fight-club'] },
  { id: 'tier-c', name: 'C', color: '#6b0f2b', items: [] },
  { id: 'tier-d', name: 'D', color: '#4c0519', items: [] }
];

// Rich Curated Offline / Instant Media Database for Online Search (Russian + English)
const EXTENDED_MEDIA_DATABASE = [
  // --- ANIME ---
  {
    id: 'ext-naruto',
    title: 'Наруто (Naruto)',
    originalTitle: 'Naruto: Shippuuden',
    type: 'anime',
    year: '2002-2017',
    duration: '720 эп.',
    rating: '8.3',
    poster: 'https://media.kitsu.app/anime/poster_images/11/medium.jpg',
    synopsis: 'История Наруто Узумаки, ниндзя-подростка, мечтающего стать Хокаге.'
  },
  {
    id: 'ext-bleach',
    title: 'Блич (Bleach)',
    originalTitle: 'Bleach',
    type: 'anime',
    year: '2004-2023',
    duration: '392 эп.',
    rating: '8.2',
    poster: 'https://media.kitsu.app/anime/poster_images/244/medium.jpg',
    synopsis: 'Ичиго Куросаки случайно получает силы синигами — проводника душ.'
  },
  {
    id: 'ext-one-piece',
    title: 'Ван-Пис (One Piece)',
    originalTitle: 'One Piece',
    type: 'anime',
    year: '1999-2024',
    duration: '1100+ эп.',
    rating: '8.7',
    poster: 'https://media.kitsu.app/anime/poster_images/12/medium.jpg',
    synopsis: 'Монки Д. Луффи собирает команду пиратов, чтобы найти величайшее сокровище Ван-Пис.'
  },
  {
    id: 'ext-hunter',
    title: 'Охотник х Охотник (Hunter x Hunter)',
    originalTitle: 'Hunter x Hunter',
    type: 'anime',
    year: '2011-2014',
    duration: '148 эп.',
    rating: '9.0',
    poster: 'https://media.kitsu.app/anime/poster_images/6448/medium.jpg',
    synopsis: 'Гон Фрикс отправляется на экзамен охотников, чтобы найти своего легендарного отца Джина.'
  },
  {
    id: 'ext-berserk',
    title: 'Берсерк (Berserk)',
    originalTitle: 'Kenpuu Denki Berserk',
    type: 'anime',
    year: '1997',
    duration: '25 эп.',
    rating: '8.7',
    poster: 'https://media.kitsu.app/anime/poster_images/213/medium.jpg',
    synopsis: 'Мрачная сага о Гатсе, Черном Мечнике, и харизматичном лидере Банды Ястреба Гриффите.'
  },
  {
    id: 'ext-vinland',
    title: 'Сага о Винланде (Vinland Saga)',
    originalTitle: 'Vinland Saga',
    type: 'anime',
    year: '2019-2023',
    duration: '48 эп.',
    rating: '8.8',
    poster: 'https://media.kitsu.app/anime/poster_images/41935/medium.jpg',
    synopsis: 'Юный Торфинн жаждет отомстить за смерть отца в эпоху безжалостных походов викингов.'
  },
  {
    id: 'ext-tokyo-ghoul',
    title: 'Токийский гуль (Tokyo Ghoul)',
    originalTitle: 'Tokyo Ghoul',
    type: 'anime',
    year: '2014',
    duration: '12 эп.',
    rating: '7.8',
    poster: 'https://media.kitsu.app/anime/poster_images/8267/medium.jpg',
    synopsis: 'Кэн Канэки становится наполовину гулем после нападения и учится выживать среди монстров.'
  },
  {
    id: 'ext-code-geass',
    title: 'Код Гиас: Восставший Лелуш',
    originalTitle: 'Code Geass: Hangyaku no Lelouch',
    type: 'anime',
    year: '2006-2008',
    duration: '50 эп.',
    rating: '8.7',
    poster: 'https://media.kitsu.app/anime/poster_images/1429/medium.jpg',
    synopsis: 'Опальный принц Лелуш получает силу абсолютного подчинения и начинает восстание против империи.'
  },
  {
    id: 'ext-cowboy-bebop',
    title: 'Ковбой Бибоп (Cowboy Bebop)',
    originalTitle: 'Cowboy Bebop',
    type: 'anime',
    year: '1998',
    duration: '26 эп.',
    rating: '8.8',
    poster: 'https://media.kitsu.app/anime/poster_images/1/medium.jpg',
    synopsis: 'Команда охотников за головами путешествует по Солнечной системе под звуки джаза.'
  },
  {
    id: 'ext-howl',
    title: 'Ходячий замок (Howl\'s Moving Castle)',
    originalTitle: 'Howl no Ugoku Shiro',
    type: 'anime',
    year: '2004',
    duration: '119 мин',
    rating: '8.7',
    poster: 'https://media.kitsu.app/anime/poster_images/176/medium.jpg',
    synopsis: 'Софи, превращенная ведьмой в старуху, находит приют в шагающем замке волшебника Хаула.'
  },
  {
    id: 'ext-mononoke',
    title: 'Принцесса Мононоке (Princess Mononoke)',
    originalTitle: 'Mononoke Hime',
    type: 'anime',
    year: '1997',
    duration: '133 мин',
    rating: '8.7',
    poster: 'https://media.kitsu.app/anime/poster_images/170/medium.jpg',
    synopsis: 'Принц Аситака оказывается в эпицентре войны между лесными богами и людьми.'
  },
  {
    id: 'ext-stein-gate',
    title: 'Врата Штейна (Steins;Gate)',
    originalTitle: 'Steins;Gate',
    type: 'anime',
    year: '2011',
    duration: '24 эп.',
    rating: '9.1',
    poster: 'https://media.kitsu.app/anime/poster_images/5857/medium.jpg',
    synopsis: 'Эксцентричный ученый Ринтаро Окабэ случайно изобретает способ отправлять сообщения в прошлое.'
  },

  // --- MOVIES ---
  {
    id: 'ext-lotr',
    title: 'Властелин колец: Возвращение короля',
    originalTitle: 'The Lord of the Rings: The Return of the King',
    type: 'movie',
    year: '2003',
    duration: '201 мин',
    rating: '9.0',
    poster: 'https://m.media-amazon.com/images/M/MV5BMTZkMjBjNWMtZGI5OC00MGU0LTk4ZTItODg2NWM3NTVmNWQ4XkEyXkFqcGc@._V1_SX300.jpg',
    synopsis: 'Кульминация эпической битвы за Средиземье и финал похода Фродо к Роковой горе.'
  },
  {
    id: 'ext-shawshank',
    title: 'Побег из Шоушенка (The Shawshank Redemption)',
    originalTitle: 'The Shawshank Redemption',
    type: 'movie',
    year: '1994',
    duration: '142 мин',
    rating: '9.3',
    poster: 'https://m.media-amazon.com/images/M/MV5BMDAyY2FhYjctNDc5OS00MDNlLThiMGUtY2UxYWVkNGY2ZjljXkEyXkFqcGc@._V1_SX300.jpg',
    synopsis: 'Банкир Энди Дюфрейн, несправедливо осужденный за убийство, обретает надежду в мрачной тюрьме.'
  },
  {
    id: 'ext-titanic',
    title: 'Титаник (Titanic)',
    originalTitle: 'Titanic',
    type: 'movie',
    year: '1997',
    duration: '194 мин',
    rating: '7.9',
    poster: 'https://m.media-amazon.com/images/M/MV5BYzYyN2FiZmUtYWYzMy00MzViLWJkZTMtOGY1ZjgzNWMwN2YxXkEyXkFqcGc@._V1_SX300.jpg',
    synopsis: 'Трагическая история любви бедного художника Джека и аристократки Розы на борту гигантского лайнера.'
  },
  {
    id: 'ext-gladiator',
    title: 'Гладиатор (Gladiator)',
    originalTitle: 'Gladiator',
    type: 'movie',
    year: '2000',
    duration: '155 мин',
    rating: '8.5',
    poster: 'https://m.media-amazon.com/images/M/MV5BYWQ4YmNjYjEtOWE1Zi00Y2U4LWI4NTAtMTU0MjkxNWQ1ZmJiXkEyXkFqcGc@._V1_SX300.jpg',
    synopsis: 'Преданный римский полководец Максимус становится гладиатором, чтобы отомстить императору Комоду.'
  },
  {
    id: 'ext-whiplash',
    title: 'Одержимость (Whiplash)',
    originalTitle: 'Whiplash',
    type: 'movie',
    year: '2014',
    duration: '106 мин',
    rating: '8.5',
    poster: 'https://m.media-amazon.com/images/M/MV5BOTA5NDZlZGUtMjAxOS00YTRkLTkwYmMtYWQ0NWEwZD阳MGYxXkEyXkFqcGc@._V1_SX300.jpg',
    synopsis: 'Молодой барабанщик Эндрю мечтает стать великим под руководством безжалостного дирижера Флетчера.'
  },
  {
    id: 'ext-shutter-island',
    title: 'Остров проклятых (Shutter Island)',
    originalTitle: 'Shutter Island',
    type: 'movie',
    year: '2010',
    duration: '138 мин',
    rating: '8.2',
    poster: 'https://m.media-amazon.com/images/M/MV5BN2EyZjM3NzUtNWUzMi00MTgxLWI0NTctMzY4M2VlOTdjZWRiXkEyXkFqcGc@._V1_SX300.jpg',
    synopsis: 'Маршалы США расследуют исчезновение пациентки из закрытой психиатрической клиники на острове.'
  },
  {
    id: 'ext-leon',
    title: 'Леон (Léon: The Professional)',
    originalTitle: 'Léon',
    type: 'movie',
    year: '1994',
    duration: '110 мин',
    rating: '8.5',
    poster: 'https://m.media-amazon.com/images/M/MV5BOTgyMWNkNzAtccd2MS00MmUxLTk4ZTItNDAzNmVkM2U1YTk2XkEyXkFqcGc@._V1_SX300.jpg',
    synopsis: 'Профессиональный киллер берет под опеку 12-летнюю Матильду, чью семью убили коррумпированные копы.'
  },
  {
    id: 'ext-wolf',
    title: 'Волк с Уолл-стрит (The Wolf of Wall Street)',
    originalTitle: 'The Wolf of Wall Street',
    type: 'movie',
    year: '2013',
    duration: '180 мин',
    rating: '8.2',
    poster: 'https://m.media-amazon.com/images/M/MV5BMjIxMjgxNTk0MF5BMl5BanBnXkFtZTgwNjIyOTg2MDE@._V1_SX300.jpg',
    synopsis: 'Взлет и безумное падение брокера Джордана Белфорта в мире шальных денег.'
  },
  {
    id: 'ext-forrest-gump',
    title: 'Форрест Гамп (Forrest Gump)',
    originalTitle: 'Forrest Gump',
    type: 'movie',
    year: '1994',
    duration: '142 мин',
    rating: '8.8',
    poster: 'https://m.media-amazon.com/images/M/MV5BNDYwNzVjMTItZmU5YS00YjQ5LTljYjgtMjY2NDVmYWMyNWFmXkEyXkFqcGc@._V1_SX300.jpg',
    synopsis: 'Трогательная история добросердечного Форреста Гампа, ставшего свидетелем ключевых событий эпохи.'
  },
  {
    id: 'ext-joker',
    title: 'Джокер (Joker)',
    originalTitle: 'Joker',
    type: 'movie',
    year: '2019',
    duration: '122 мин',
    rating: '8.4',
    poster: 'https://m.media-amazon.com/images/M/MV5BNGVjNWI4ZGUtNzE0MS00YTJmLWE0ZDctN2ZiYTk2YmI3NTYyXkEyXkFqcGc@._V1_SX300.jpg',
    synopsis: 'Артур Флек пытается найти свое место в мрачном Готэме, медленно погружаясь в безумие.'
  },
  {
    id: 'ext-parasite',
    title: 'Паразиты (Parasite)',
    originalTitle: 'Gisaengchung',
    type: 'movie',
    year: '2019',
    duration: '132 мин',
    rating: '8.5',
    poster: 'https://m.media-amazon.com/images/M/MV5BYjk1N2UzOTMtOGQ4ZS00NWMzLThjOTctOWVhOWYxNmU2Y2FjXkEyXkFqcGc@._V1_SX300.jpg',
    synopsis: 'Бедная семья обманом устраивается на работу к богачам, запуская цепь непредсказуемых событий.'
  }
];

// Presets registry
window.TIERLIST_PRESETS = {
  anime: STARTER_ANIME,
  movies: STARTER_MOVIES,
  defaultTiers: DEFAULT_TIERS,
  extendedMedia: EXTENDED_MEDIA_DATABASE,
  createPosterSVG: createPosterSVG
};
