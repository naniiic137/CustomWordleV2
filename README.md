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

The puzzle creator includes 21 unique game modes:

| Mode | Icon | Description |
|------|------|-------------|
| **Glitch** | ⚡ | Tiles randomly flicker with wrong letters (aggressive) |
| **Hide on loss** | 🙈 | The answer stays secret if you lose |
| **No feedback** | 🔇 | No colors revealed - pure guessing |
| **No backspace** | 🚫 | Cannot delete letters once typed |
| **One strike** | 💀 | Wrong guess ends the game immediately |
| **Reveal first** | 🔤 | First letter is given for free |
| **Share result** | 📊 | Copy emoji grid result to clipboard |
| **Multi-word** | 🧩 | Guess two words simultaneously |
| **Timed mode** | ⏱ | Race against a countdown timer |
| **Fibble** | 🤥 | One color per row lies about the answer |
| **Absurdle** | 👾 | Word shifts to avoid your guesses |
| **Mirror** | 🪞 | Green and Yellow feedback are reversed |
| **Fake News** | 📰 | One random tile gives wrong feedback |
| **Gaslighting** | 😵 | Word changes every 3rd guess |
| **Schrödinger** | 🐱 | One slot contains two letters at once |
| **False Hope** | 🌝 | First row fakes 2 yellow tiles |
| **Mimic** | 🎭 | Your first guess becomes the word |
| **Dict Restrict** | 📖 | Next guess must start with same letter |
| **Number Mode** | 🔢 | Guess numbers instead of words |
| **No Reuse** | 🔒 | Can't guess letters marked as absent |
| **Blind Mode** | 👁️‍🗨️ | Keyboard doesn't show feedback |

### Advanced Features
- **Progress restore** - Resume games after page refresh
- **Dual board mode** - Solve two words at once
- **Timer with danger state** - Visual countdown with warning at 5 seconds
- **Mode display** - Show active modes to players (optional)
- **Hint unlocking** - Hints unlock after N guesses (optional)
- **Custom hint text** - Creator can add a text hint for players

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
5. Click "Generate Link"
6. Share the generated link with players

### Link Structure

Puzzle links contain encrypted configuration data:
- Secret word (encrypted)
- Game settings (guesses, hints, etc.)
- Enabled game modes
- Player limits

The links use URL fragments for the decryption key, ensuring the actual word never hits the server.

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

## License

This project is provided for educational and personal use.

## Important Notes

### Work in Progress

Some game modes are experimental or still being refined. The following modes may have quirks or incomplete behavior:

- **Absurdle** - Currently uses a limited word list; may not work correctly with non-5-letter words
- **Schrödinger** - The dual-letter slot mechanic is partially implemented
- **Gaslighting** - Word shifting logic may need adjustment
- **Fibble** - Row deception mechanics are experimental
- **Mimic** - First guess word replacement needs testing
- **False Hope** - Fake yellow generation is basic
- **Dict Restrict** - Letter restriction logic may have edge cases

### Core Features (Fully Functional)

The most important features for a complete puzzle experience are working reliably:

- **Attempt limits** - Links expire after a set number of attempts per player
- **Hide on loss** - Answer remains secret when players lose (if enabled)
- **Multi-word mode** - Solve two words simultaneously
- **Timed mode** - Countdown timer with visual feedback
- **Progress saving** - Games persist across page refreshes
- **Lobby limits** - Control concurrent player slots
- **Hint system** - Reveal letters with configurable unlock timing
- **Shareable results** - Copy emoji grid to clipboard
- **All basic modes** - Glitch, Mirror, No feedback, No backspace, One strike, Reveal first, Fake News

The puzzle creator and link encryption system are fully operational and production-ready.

## Credits

Based on the original [Wordle](https://www.nytimes.com/games/wordle/index.html) game by Josh Wardle.
