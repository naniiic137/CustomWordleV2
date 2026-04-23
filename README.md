# Custom Wordle

A fully-featured Wordle clone with a powerful puzzle creator, multiple game modes, and secure link-based puzzle sharing. Create custom word puzzles with unique rules and share them with friends via encrypted links.

**Play the game:** https://rainbow-jalebi-6d8f8c.netlify.app/creator.html

## Table of Contents

- [Features](#features)
- [Game Modes](#game-modes)
- [Puzzle Creator](#puzzle-creator)
- [Security](#security)
- [Technical Stack](#technical-stack)
- [Installation](#installation)
- [Development](#development)
- [Project Structure](#project-structure)

## Features

### Core Gameplay
- **Classic Wordle mechanics** - Guess a 5-letter word in 6 tries
- **Color-coded feedback** - Green (correct), Yellow (present), Gray (absent)
- **Virtual keyboard** - On-screen keyboard with feedback tracking
- **Hint system** - Reveal a random letter in the word
- **Progress saving** - Automatic local storage of in-progress games

### Puzzle Creator
- **Custom word selection** - Set any secret word you want
- **Configurable guesses** - 1-20 guesses per attempt
- **Hint configuration** - 0-10 hints available
- **Play limits** - Set max attempts per person (1-100)
- **Lobby size** - Limit concurrent players (1-10,000)
- **Shareable links** - Encrypted puzzle links to share with others

### Game Modes

The puzzle creator includes 33 game modes across 5 categories:

#### 🎨 Visual / Feedback Modes

| Mode | Icon | Description |
|------|------|-------------|
| **Glitch** | ⚡ | Tiles randomly flicker with wrong letters |
| **Hide on Loss** | 🙈 | The answer stays secret if you lose |
| **No Feedback** | 🔇 | No colors revealed — pure guessing |
| **Mirror** | 🪞 | Green and Yellow feedback are reversed |
| **Blind Mode** | 👁️‍🗨️ | Keyboard doesn't show feedback |

#### ⚙️ Input Restriction Modes

| Mode | Icon | Description |
|------|------|-------------|
| **No Backspace** | 🚫 | Cannot delete letters once typed |
| **No Reuse** | 🔒 | Can't guess letters marked as absent |
| **Reveal First** | 🔤 | First letter is given for free |
| **Dict Restrict** | 📖 | Next guess must start with same letter as previous |
| **Chain** | 🔗 | Each guess must start with the last letter of your previous guess |

#### 💀 Difficulty / Penalty Modes

| Mode | Icon | Description |
|------|------|-------------|
| **One Strike** | 💀 | Wrong guess ends the game immediately |
| **Sniper** | 🎯 | One guess only — make it count |
| **Blitz** | ⚡ | Only 3 guesses total |
| **Decay** | ⏳ | A keyboard key is permanently disabled every 2 guesses |
| **Minefield** | 💣 | 2 secret mine positions — wrong letter there costs an extra guess |

#### 🧠 Memory / Hidden Info Modes

| Mode | Icon | Description |
|------|------|-------------|
| **Memory** | 🧠 | Revealed tiles hide after 2 seconds (keyboard still updates) |
| **Void** | 🕳️ | One tile always shows grey regardless of the true answer |
| **Fake News** | 📰 | One random tile gives wrong feedback |
| **False Hope** | 🌝 | First row fakes 2 yellow tiles |

#### 🔀 Word-Changing Modes

| Mode | Icon | Description |
|------|------|-------------|
| **Absurdle** | 👾 | Word shifts to keep as many candidates alive as possible |
| **Gaslighting** | 😵 | Word changes every 2 guesses to maximize confusion |
| **Schrödinger** | 🐱 | One slot contains two letters — either counts as green |
| **Shuffle** | 🔀 | Secret word letters reshuffle positions after each guess |

#### 🧩 Special / Unique Modes

| Mode | Icon | Description |
|------|------|-------------|
| **Fibble** | 🤥 | One color per row lies about the answer |
| **Mimic** | 🎭 | Your first guess becomes the new secret word |
| **Reverse** | 🔄 | You see the answer — find a guess that produces the target pattern |
| **Anagram** | 🔡 | All letters revealed scrambled; you must use only those letters |
| **Spiral** | 🌀 | Sequential rounds: 3→4→5→6 letter words, all must be solved |
| **Multi-word** | 🧩 | Guess two words simultaneously; win requires solving both |

#### 📊 Utility / Sharing Modes

| Mode | Icon | Description |
|------|------|-------------|
| **Share Result** | 📊 | Copy emoji grid result to clipboard after game |
| **Timed Mode** | ⏱ | Race against a countdown timer |
| **Book Mode** | 📚 | Creator sets a pool of 5–30 words; each player is randomly assigned one |

#### 🔢 Number Mode

| Mode | Icon | Description |
|------|------|-------------|
| **Number Mode** | 🔢 | Guess a number instead of a word; works with Multi-word for dual number boards or hybrid (one letter board + one number board) |

### Advanced Features
- **Progress restore** - Resume games after page refresh
- **Dual board mode** - Solve two words at once
- **Mixed dual board** - Board 1 letters + Board 2 numbers
- **Timer with danger state** - Visual countdown with warning at 5 seconds
- **Mode display** - Show active modes to players (optional)
- **Hint unlocking** - Hints unlock after N guesses (optional)
- **Custom hint text** - Creator can add a text hint for players
- **Visible submit action in Number Mode** - Enter key + submit button support

## Puzzle Creator

### Creating a Puzzle

1. Visit the creator page at `/creator.html`
2. Enter your secret word
3. Configure optional settings:
   - Number of hints (0-10)
   - Number of guesses (1-20)
   - Max attempts per player
   - Max concurrent players
4. Enable any game modes you want
5. *(Book Mode only)* Paste your word pool (5–30 words, one per line) in the text panel that appears
6. Click "Generate Link"
7. Share the generated link with players

### Link Structure

Puzzle links contain encrypted configuration data:
- Secret word (encrypted)
- Game settings (guesses, hints, etc.)
- Enabled game modes
- Player limits
- Book Mode word pool (when enabled)

The links use URL fragments for the decryption key, ensuring the actual word never hits the server.

### Mode Compatibility

Most modes are freely combinable. A few are intentionally constrained:

| Rule | Detail |
|------|--------|
| **Spiral** | Single-board, letter-only — not compatible with Multi-word or Number Mode |
| **One Strike + Blitz** | One Strike takes priority (1 guess overrides 3) |
| **Mixed Mode** | Available when both Multi-word and Number Mode are enabled |
| **Hard modes** | Some hard modes are restricted to single-board play |

## Security

### Encryption
- **AES-128-GCM** encryption for puzzle data
- **PBKDF2** key derivation (100,000 iterations)
- URL fragment stores the decryption token (never sent to server)
- Each puzzle link has a unique encryption key

### Attempt Tracking
- **Stable fingerprint** - Hardware-based, identical in normal and private tabs
- **Session fingerprint** - Per-tab, for lobby seat counting
- Server-side storage using Netlify Blobs
- Two separate tracking systems:
  - Per-player attempt quota (stableId)
  - Active lobby seats (sessionId)

### Privacy
- The server never sees the secret word
- Decryption happens entirely in the browser
- Player IPs are masked before storage

## Technical Stack

- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **Backend:** Netlify Functions (serverless)
- **Storage:** Netlify Blobs
- **Fonts:** Space Mono, DM Sans (Google Fonts)
- **Build:** JavaScript Obfuscator

### Browser Support
- Modern browsers with Web Crypto API support
- Requires JavaScript enabled
- Mobile-friendly responsive design

## Installation

### Prerequisites
- Node.js 18+
- Netlify CLI (for local development)

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd wordle-with-new-mods

# Install dependencies
npm install

# Start local development server
netlify dev
```

### Building for Production

```bash
# Build obfuscated script
npm run build
```

The build process obfuscates `script.js` into `script.obf.js` for production deployment.

## Development

### Local Development

Set `LOCAL_DEV = true` in `script.js` to bypass Netlify serverless calls during development:

```javascript
var LOCAL_DEV = true;
```

**Important:** Revert to `false` before deploying to production.

### Project Structure

```
├── index.html          # Main game page
├── creator.html        # Puzzle creator page
├── script.js           # Game logic (source)
├── script.obf.js       # Obfuscated game logic (production)
├── style.css           # All styles
├── package.json        # Dependencies and scripts
├── netlify.toml        # Netlify configuration
├── netlify/
│   └── functions/
│       ├── play.mjs    # Game session & attempt tracking
│       └── verify.js   # (additional verification)
```

### Key Files

| File | Purpose |
|------|---------|
| `script.js:1-110` | Crypto utilities (encryption/decryption) |
| `script.js:112-226` | Game mode implementations (Absurdle, etc.) |
| `script.js:228-415` | Game state and initialization |
| `script.js:500-690` | Timer, glitch, and mode features |
| `script.js:720-870` | Board, keyboard, and input handling |
| `netlify/functions/play.mjs` | Server-side play tracking |

## 🚧 Known Issues / Roadmap

- [ ] *(Add known bugs or limitations here)*
- [ ] *(Add planned features here)*
- [ ] *(Add future mode ideas here)*

## License

This project is provided for educational and personal use.

## Important Notes

- **Win detection is mode-safe:** Correct guesses end the game across all modes including deceptive and hard modes.
- **No Reuse is enforced as a hard restriction:** guesses containing known absent letters are blocked.
- **Absurdle/Gaslighting behavior is intentionally adversarial:** the answer can shift mid-game by design.
- **Reverse Mode:** winning requires producing the exact target feedback pattern — typing the secret word is not an automatic win.
- **Void Mode:** win detection always uses the true answer, not the misleading feedback shown to the player.
- **Chain Mode:** the first guess has no chain restriction; all subsequent guesses must start with the last letter of the previous guess.
- **Book Mode:** the creator's word pool is encoded in the link; each player is randomly assigned one word per session.
- **Creator grid is perfectly aligned:** 33 modes in an 11×3 grid with no stretched or misaligned cards.

## Credits

Based on the original [Wordle](https://www.nytimes.com/games/wordle/index.html) game by Josh Wardle.