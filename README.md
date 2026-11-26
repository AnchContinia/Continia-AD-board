# Continia AD Board

Et 3D-moodboard bygget som et solsystem. Billeder og videoer kredser om Continia-mærket, og du kan flyve rundt imellem dem.

**Live:** https://anchcontinia.github.io/Continia-AD-board/

## Tilføj indhold

### Billeder
Læg dem i [`Assets/`](Assets). Den nemmeste vej er GitHub på nettet: **Add file → Upload files**. Du kan også bruge knappen **Tilføj → Upload billeder** på siden.

- Formater: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.avif` og `.svg`.
- Videofiler (`.mp4`, `.webm`) i `Assets/` virker også.
- **Undermapper bliver egne ringe.** `Assets/Kampagne/` bliver ringen "Kampagne". Filer direkte i `Assets/` havner i "Moodboard".
- Filnavnet bliver titlen: `sommer-kampagne_01.jpg` vises som "Sommer kampagne 01".
- GitHub på nettet tager højst 25 MB pr. fil. Hold billeder under ca. 5 MB, så siden loader hurtigt.

### Kategorier
Hver ring er en kategori. Kategorierne vælges i **Alle kategorier** øverst på siden, i både orbit og liste. De ligger i [`categories.json`](categories.json):

- `kategorier` er listen og rækkefølgen, inderste ring først.
- `billeder` siger, hvilken kategori hvert billede hører til. Nøglen er stien under `Assets/`.
- Flyt et billede ved at rette kategorinavnet ud for det. Tilføj en ny kategori ved at skrive den i `kategorier` og bruge navnet ud for billederne.
- Nye billeder uden kategori havner i en ring med deres mappes navn, indtil de får en kategori.

### Videoer
Skriv linket på en ny linje i [`videos.txt`](videos.txt):

```
https://www.youtube.com/watch?v=XXXXXXXXXXX
https://youtu.be/XXXXXXXXXXX | Egen titel
https://vimeo.com/123456789 | Egen titel | Gruppe
```

YouTube (også Shorts), Vimeo og direkte `.mp4`/`.webm`-links virker. Uden titel hentes den fra YouTube/Vimeo. Videoer vises som thumbnails og afspilles inde på siden.

### Hvornår kan jeg se det?
Hvert push til `main` kører workflowet [Deploy moodboard](.github/workflows/pages.yml). Det bygger `content.json` og udgiver siden. Det tager ca. et minut. Status kan ses under **Actions**.

## Styring

| | Mus / tastatur | Touch |
|---|---|---|
| Kig rundt | Træk | Træk med én finger |
| Flyv frem og tilbage | Scroll. Du flyver mod det, markøren peger på | Knib |
| Flyt op, ned og til siden | Shift + træk, eller midterklik + træk | Træk med to fingre |
| Flyvetilstand | Hold højreklik: musen drejer kameraet, `W` `S` frem/tilbage, `A` `D` til siden, `Q` `E` ned/op. Slip for at stoppe | |
| Flyv frit | `W A S D` / piletaster, `Q` `E` ned/op | |
| Flyv hurtigere | Hold `Shift` mens du flyver eller scroller | |
| Åbn | Klik på et kort | Tryk på et kort |
| I viseren | `←` `→` bladrer, `Esc` lukker | |
| Tilbage til overblik | `H` eller sigtekorn-knappen | Sigtekorn-knappen |
| Orbit eller liste | Knappen nederst i midten, eller `L` | Knappen nederst i midten |
| Ringenes hældning | Plan/Kryds under logoet, eller `K`. Plan: alle ringe i ét plan, 20° hældning. Kryds: hver kategori hælder sin vej, 35–55° | Plan/Kryds under logoet |

## Kør lokalt

```sh
node scripts/build-manifest.mjs   # bygger content.json fra Assets/ og videos.txt
python3 -m http.server 8080       # åbn http://localhost:8080
```

Siden skal serveres over http. YouTube-embeds virker ikke fra `file://`.

## Opbygning

| Fil | Hvad |
|---|---|
| `index.html` | Siden: HUD, viser og tilgængelig indholdsliste |
| `src/main.js` | 3D-scenen (Three.js 0.170): layout i ringe, kamera, input, thumbnails |
| `src/listview.js` | Listevisningen: alt indhold som grid, grupperet som ringene |
| `src/viewer.js` | Viseren: billede eller video alene på en mørk baggrund |
| `src/motion.js` | Continia motion-tokens i JS (varigheder og easings) |
| `src/styles.css` | Styles på Continia Front end-designsystemet |
| `src/config.js` | Repoet som "Tilføj"-knapperne linker til |
| `scripts/build-manifest.mjs` | Scanner `Assets/`, `categories.json` og `videos.txt` og skriver `content.json` |

Ikoner: Font Awesome Light fra Continias Pro-kit (se [`.font-awesome.md`](.font-awesome.md)). Repoet indeholder ingen Font Awesome-filer, ikonerne hentes fra kittet.

Design: Continia Front end-designsystemet. Mørk Tech Blue-grund, Innovation Blue kun som signal og motion-tokens til al timing. Viseren viser billedet uden ramme. `prefers-reduced-motion` stopper orbit og kameraflyvninger.
