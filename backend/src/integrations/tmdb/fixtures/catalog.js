/**
 * Mock catalog fixture.
 *
 * Purpose: the entire product must be runnable and demonstrable before any TMDB
 * key exists (section 32). This catalogue backs the mock TMDB adapter, the mock
 * streaming adapter and the mock vision adapter, so the whole pipeline — upload,
 * vision, candidate generation, matching, confidence, result, history, watchlist —
 * exercises real code paths with real data shapes.
 *
 * It is NEVER presented as live data: `isMock: true` travels with every response and
 * the app renders a "simulated result" banner.
 *
 * Content policy: titles, years, cast and crew are factual metadata. The `overview`
 * strings are ORIGINAL one-line descriptions written for this project — no synopsis
 * text is copied from TMDB or any other source. No poster/backdrop files are
 * bundled; `posterPath: null` makes the UI render its own generated placeholder,
 * which is more honest than shipping stand-in artwork.
 */

const movie = (o) => ({ mediaType: 'movie', endYear: null, ...o });
const series = (o) => ({ mediaType: 'tv', ...o });

export const CATALOG = [
  movie({
    tmdbId: 'mock-155',
    title: 'The Dark Knight',
    originalTitle: 'The Dark Knight',
    year: 2008,
    runtime: 152,
    genres: ['Action', 'Crime', 'Drama'],
    director: ['Christopher Nolan'],
    writers: ['Jonathan Nolan', 'Christopher Nolan'],
    cast: ['Christian Bale', 'Heath Ledger', 'Aaron Eckhart', 'Michael Caine', 'Gary Oldman'],
    characters: ['Bruce Wayne', 'The Joker', 'Harvey Dent', 'Alfred Pennyworth', 'James Gordon'],
    overview: 'A masked vigilante, a district attorney and an anarchist in face paint collide over the soul of a city.',
    keywords: ['batman', 'joker', 'gotham', 'bank heist', 'clown mask', 'armoured car', 'hospital', 'ferry', 'skyline'],
    visualClues: ['dark blue-grey colour grade', 'IMAX city aerials', 'clown makeup', 'armoured truck chase', 'hospital explosion'],
    voteAverage: 8.5,
    popularity: 92,
    providerKeys: ['netflix', 'prime', 'apple'],
  }),
  movie({
    tmdbId: 'mock-27205',
    title: 'Inception',
    originalTitle: 'Inception',
    year: 2010,
    runtime: 148,
    genres: ['Science Fiction', 'Action', 'Thriller'],
    director: ['Christopher Nolan'],
    writers: ['Christopher Nolan'],
    cast: ['Leonardo DiCaprio', 'Joseph Gordon-Levitt', 'Elliot Page', 'Tom Hardy', 'Marion Cotillard'],
    characters: ['Dom Cobb', 'Arthur', 'Ariadne', 'Eames', 'Mal'],
    overview: 'A team of specialists enters shared dreams to plant an idea in a rival heir’s mind.',
    keywords: ['dream', 'spinning top', 'hotel corridor', 'snow fortress', 'van chase', 'subconscious', 'limbo'],
    visualClues: ['rotating corridor fight', 'rain-soaked city', 'folding Paris street', 'snow-bound bunker', 'van falling off a bridge'],
    voteAverage: 8.4,
    popularity: 88,
    providerKeys: ['netflix', 'prime', 'apple'],
  }),
  movie({
    tmdbId: 'mock-335984',
    title: 'Blade Runner 2049',
    originalTitle: 'Blade Runner 2049',
    year: 2017,
    runtime: 164,
    genres: ['Science Fiction', 'Drama', 'Mystery'],
    director: ['Denis Villeneuve'],
    writers: ['Hampton Fancher', 'Michael Green'],
    cast: ['Ryan Gosling', 'Harrison Ford', 'Ana de Armas', 'Sylvia Hoeks', 'Robin Wright'],
    characters: ['K', 'Rick Deckard', 'Joi', 'Luv', 'Lieutenant Joshi'],
    overview: 'A replicant blade runner uncovers a secret that could unravel what is left of society.',
    keywords: ['replicant', 'neon', 'los angeles', 'las vegas', 'hologram', 'rain', 'orchard', 'sea wall'],
    visualClues: ['orange dust storm', 'amber Las Vegas ruins', 'holographic companion', 'brutalist interiors', 'snow on a sea wall'],
    voteAverage: 8.1,
    popularity: 74,
    providerKeys: ['prime', 'apple', 'max'],
  }),
  movie({
    tmdbId: 'mock-603',
    title: 'The Matrix',
    originalTitle: 'The Matrix',
    year: 1999,
    runtime: 136,
    genres: ['Science Fiction', 'Action'],
    director: ['Lana Wachowski', 'Lilly Wachowski'],
    writers: ['Lana Wachowski', 'Lilly Wachowski'],
    cast: ['Keanu Reeves', 'Laurence Fishburne', 'Carrie-Anne Moss', 'Hugo Weaving', 'Joe Pantoliano'],
    characters: ['Neo', 'Morpheus', 'Trinity', 'Agent Smith', 'Cypher'],
    overview: 'A programmer learns his world is a simulation and joins a crew fighting the machines that built it.',
    keywords: ['green code', 'trench coat', 'telephone', 'lobby', 'dojo', 'agents', 'red pill'],
    visualClues: ['green-tinted digital rain', 'black trench coats and sunglasses', 'slow-motion bullet dodge', 'white dojo', 'lobby shootout'],
    voteAverage: 8.2,
    popularity: 80,
    providerKeys: ['max', 'prime', 'apple'],
  }),
  movie({
    tmdbId: 'mock-496243',
    title: 'Parasite',
    originalTitle: '기생충',
    year: 2019,
    runtime: 133,
    genres: ['Thriller', 'Drama', 'Comedy'],
    director: ['Bong Joon-ho'],
    writers: ['Bong Joon-ho', 'Han Jin-won'],
    cast: ['Song Kang-ho', 'Lee Sun-kyun', 'Cho Yeo-jeong', 'Choi Woo-shik', 'Park So-dam'],
    characters: ['Ki-taek', 'Park Dong-ik', 'Yeon-kyo', 'Ki-woo', 'Ki-jung'],
    overview: 'A struggling family infiltrates the household of a wealthy one, and the arrangement does not hold.',
    keywords: ['basement', 'flood', 'mansion', 'stairs', 'seoul', 'birthday party', 'peach'],
    visualClues: ['vertical staircase shots', 'Korean signage', 'semi-basement windows', 'heavy rain down a hill', 'suburban stone wall'],
    voteAverage: 8.5,
    popularity: 70,
    providerKeys: ['max', 'apple'],
  }),
  movie({
    tmdbId: 'mock-76341',
    title: 'Mad Max: Fury Road',
    originalTitle: 'Mad Max: Fury Road',
    year: 2015,
    runtime: 120,
    genres: ['Action', 'Adventure', 'Science Fiction'],
    director: ['George Miller'],
    writers: ['George Miller', 'Brendan McCarthy', 'Nick Lathouris'],
    cast: ['Tom Hardy', 'Charlize Theron', 'Nicholas Hoult', 'Hugh Keays-Byrne', 'Zoë Kravitz'],
    characters: ['Max Rockatansky', 'Imperator Furiosa', 'Nux', 'Immortan Joe', 'Toast the Knowing'],
    overview: 'A drifter and a one-armed war captain flee a desert warlord across a scorched wasteland.',
    keywords: ['desert', 'war rig', 'sandstorm', 'chrome', 'guitar flame', 'wasteland', 'polecats'],
    visualClues: ['orange desert palette', 'flame-throwing guitar', 'spiked vehicles', 'sandstorm wall', 'chrome spray to the mouth'],
    voteAverage: 7.6,
    popularity: 68,
    providerKeys: ['max', 'prime'],
  }),
  movie({
    tmdbId: 'mock-157336',
    title: 'Interstellar',
    originalTitle: 'Interstellar',
    year: 2014,
    runtime: 169,
    genres: ['Science Fiction', 'Adventure', 'Drama'],
    director: ['Christopher Nolan'],
    writers: ['Jonathan Nolan', 'Christopher Nolan'],
    cast: ['Matthew McConaughey', 'Anne Hathaway', 'Jessica Chastain', 'Mackenzie Foy', 'Michael Caine'],
    characters: ['Cooper', 'Dr. Brand', 'Murph', 'Young Murph', 'Professor Brand'],
    overview: 'A former pilot leaves his children behind to search for a habitable world beyond a failing Earth.',
    keywords: ['cornfield', 'wormhole', 'tesseract', 'ice planet', 'water planet', 'robot', 'dust'],
    visualClues: ['dust storms over farmland', 'ringed spacecraft docking', 'frozen cloud world', 'shallow ocean under a giant wave', 'bookshelf'],
    voteAverage: 8.4,
    popularity: 78,
    providerKeys: ['prime', 'apple', 'paramount'],
  }),
  movie({
    tmdbId: 'mock-129',
    title: 'Spirited Away',
    originalTitle: '千と千尋の神隠し',
    year: 2001,
    runtime: 125,
    genres: ['Animation', 'Family', 'Fantasy'],
    director: ['Hayao Miyazaki'],
    writers: ['Hayao Miyazaki'],
    cast: ['Rumi Hiiragi', 'Miyu Irino', 'Mari Natsuki', 'Takashi Naito', 'Yasuko Sawaguchi'],
    characters: ['Chihiro', 'Haku', 'Yubaba', 'Akio Ogino', 'Yuko Ogino'],
    overview: 'A girl wandering into a spirit world must work in a bathhouse to win back her parents and her name.',
    keywords: ['bathhouse', 'spirit', 'dragon', 'train over water', 'no-face', 'lantern', 'boiler room'],
    visualClues: ['hand-painted backgrounds', 'red lanterns', 'silent train on water', 'soot sprites', 'enormous bathhouse interiors'],
    voteAverage: 8.5,
    popularity: 72,
    providerKeys: ['max', 'netflix'],
  }),
  series({
    tmdbId: 'mock-66732',
    title: 'Stranger Things',
    originalTitle: 'Stranger Things',
    year: 2016,
    endYear: 2025,
    genres: ['Drama', 'Fantasy', 'Mystery'],
    director: ['The Duffer Brothers'],
    writers: ['The Duffer Brothers'],
    cast: ['Millie Bobby Brown', 'Finn Wolfhard', 'Winona Ryder', 'David Harbour', 'Gaten Matarazzo'],
    characters: ['Eleven', 'Mike Wheeler', 'Joyce Byers', 'Jim Hopper', 'Dustin Henderson'],
    overview: 'Children in a small Indiana town confront a parallel dimension and the experiments that opened it.',
    keywords: ['upside down', 'walkie talkie', 'bike', 'mall', 'laboratory', 'demogorgon', 'neon'],
    visualClues: ['1980s small-town America', 'neon title card in red', 'bicycles at night', 'government lab corridors', 'Christmas lights'],
    voteAverage: 8.6,
    popularity: 95,
    seasons: [
      {
        number: 1,
        name: 'Season 1',
        airDate: '2016-07-15',
        episodes: [
          { number: 1, name: 'Chapter One: The Vanishing of Will Byers', runtime: 47, airDate: '2016-07-15', overview: 'A boy disappears on his way home and a frightened girl appears in the woods.' },
          { number: 2, name: 'Chapter Two: The Weirdo on Maple Street', runtime: 55, airDate: '2016-07-15', overview: 'The boys hide their new friend while a search party widens.' },
          { number: 3, name: 'Chapter Three: Holly, Jolly', runtime: 51, airDate: '2016-07-15', overview: 'A flickering light display carries a message nobody wants to read.' },
        ],
      },
      {
        number: 2,
        name: 'Season 2',
        airDate: '2017-10-27',
        episodes: [
          { number: 1, name: 'Chapter One: MADMAX', runtime: 48, airDate: '2017-10-27', overview: 'A year later, a new girl arrives in town and the arcade becomes a battleground.' },
          { number: 2, name: 'Chapter Two: Trick or Treat, Freak', runtime: 56, airDate: '2017-10-27', overview: 'Halloween night splits the group in several directions at once.' },
        ],
      },
    ],
    providerKeys: ['netflix'],
  }),
  series({
    tmdbId: 'mock-1396',
    title: 'Breaking Bad',
    originalTitle: 'Breaking Bad',
    year: 2008,
    endYear: 2013,
    genres: ['Drama', 'Crime', 'Thriller'],
    director: ['Vince Gilligan'],
    writers: ['Vince Gilligan'],
    cast: ['Bryan Cranston', 'Aaron Paul', 'Anna Gunn', 'Dean Norris', 'Betsy Brandt'],
    characters: ['Walter White', 'Jesse Pinkman', 'Skyler White', 'Hank Schrader', 'Marie Schrader'],
    overview: 'A chemistry teacher facing a terminal diagnosis turns to manufacturing drugs to provide for his family.',
    keywords: ['rv', 'desert', 'lab', 'mask', 'new mexico', 'barrel', 'blue crystal'],
    visualClues: ['New Mexico desert', 'yellow hazmat suits', 'gas masks', 'beaten RV', 'sodium-vapour night streets'],
    voteAverage: 8.9,
    popularity: 90,
    seasons: [
      {
        number: 1,
        name: 'Season 1',
        airDate: '2008-01-20',
        episodes: [
          { number: 1, name: 'Pilot', runtime: 58, airDate: '2008-01-20', overview: 'A diagnosis and a ride-along push a chemistry teacher into a new line of work.' },
          { number: 2, name: "Cat's in the Bag...", runtime: 48, airDate: '2008-01-27', overview: 'Two very unprepared partners deal with the consequences of their first job.' },
          { number: 3, name: '...And the Bag\'s in the River', runtime: 48, airDate: '2008-02-10', overview: 'A basement decision has to be made and neither man wants to make it.' },
        ],
      },
      {
        number: 5,
        name: 'Season 5',
        airDate: '2012-07-15',
        episodes: [
          { number: 14, name: 'Ozymandias', runtime: 48, airDate: '2013-09-15', overview: 'Everything the operation was built on gives way at once in the desert.' },
          { number: 16, name: 'Felina', runtime: 55, airDate: '2013-09-29', overview: 'A final return to the place it all started, with one unfinished piece of business.' },
        ],
      },
    ],
    providerKeys: ['netflix'],
  }),
  series({
    tmdbId: 'mock-87108',
    title: 'Chernobyl',
    originalTitle: 'Chernobyl',
    year: 2019,
    endYear: 2019,
    genres: ['Drama', 'History', 'Thriller'],
    director: ['Craig Mazin'],
    writers: ['Craig Mazin'],
    cast: ['Jared Harris', 'Stellan Skarsgård', 'Emily Watson', 'Paul Ritter', 'Jessie Buckley'],
    characters: ['Valery Legasov', 'Boris Shcherbina', 'Ulana Khomyuk', 'Anatoly Dyatlov', 'Lyudmilla Ignatenko'],
    overview: 'Scientists and officials confront the cost of a nuclear disaster and the system that produced it.',
    keywords: ['reactor', 'graphite', 'firefighter', 'helicopter', 'hospital', 'bridge', 'mine'],
    visualClues: ['Soviet-era concrete interiors', 'gas masks left in a hospital', 'blue glow over a reactor roof', 'helicopter over a smoking core', 'concrete "biorobots"'],
    voteAverage: 8.7,
    popularity: 66,
    seasons: [
      {
        number: 1,
        name: 'Miniseries',
        airDate: '2019-05-06',
        episodes: [
          { number: 1, name: '1:23:45', runtime: 65, airDate: '2019-05-06', overview: 'A late-night test goes wrong and the first responders walk into something they cannot see.' },
          { number: 2, name: 'Please Remain Calm', runtime: 65, airDate: '2019-05-13', overview: 'Two men are sent to the site to establish what actually happened.' },
          { number: 3, name: 'Open Wide, O Earth', runtime: 60, airDate: '2019-05-20', overview: 'The immediate threat is contained, the long-term one is not.' },
        ],
      },
    ],
    providerKeys: ['max'],
  }),
  series({
    tmdbId: 'mock-100088',
    title: 'The Last of Us',
    originalTitle: 'The Last of Us',
    year: 2023,
    endYear: null,
    genres: ['Drama', 'Science Fiction', 'Adventure'],
    director: ['Craig Mazin', 'Neil Druckmann'],
    writers: ['Craig Mazin', 'Neil Druckmann'],
    cast: ['Pedro Pascal', 'Bella Ramsey', 'Anna Torv', 'Gabriel Luna', 'Nick Offerman'],
    characters: ['Joel Miller', 'Ellie Williams', 'Tess', 'Tommy Miller', 'Bill'],
    overview: 'A smuggler escorts a teenager across a quarantined country because she may be the key to a cure.',
    keywords: ['quarantine zone', 'fungal', 'gas mask', 'overgrown city', 'horse', 'cabin', 'checkpoint'],
    visualClues: ['overgrown post-collapse city', 'gas masks and ration cards', 'military quarantine signage', 'abandoned cars on a highway', 'snowy mountain town'],
    voteAverage: 8.4,
    popularity: 85,
    seasons: [
      {
        number: 1,
        name: 'Season 1',
        airDate: '2023-01-15',
        episodes: [
          { number: 1, name: 'When You\'re Lost in the Darkness', runtime: 81, airDate: '2023-01-15', overview: 'A lockdown, an outbreak and a promise made twenty years too late.' },
          { number: 2, name: 'Infected', runtime: 53, airDate: '2023-01-22', overview: 'A museum detour proves the city is far from empty.' },
          { number: 3, name: 'Long, Long Time', runtime: 76, airDate: '2023-01-29', overview: 'A survivalist and a stranded stranger build a life in a fortified town.' },
        ],
      },
    ],
    providerKeys: ['max', 'prime'],
  }),
];

/** Ordered list used for the app's "Popular now" rails in mock mode. */
export const TRENDING = CATALOG.map((c) => c.tmdbId);

export function findById(tmdbId) {
  const key = String(tmdbId ?? '');
  return CATALOG.find((c) => c.tmdbId === key || c.tmdbId === `mock-${key}`) ?? null;
}

export function findSeriesByTitle(title) {
  const needle = String(title || '').toLowerCase().trim();
  return CATALOG.find((c) => c.mediaType === 'tv' && c.title.toLowerCase() === needle) ?? null;
}

export function allByType(mediaType) {
  return CATALOG.filter((c) => !mediaType || c.mediaType === mediaType);
}

export default { CATALOG, TRENDING, findById, findSeriesByTitle, allByType };
