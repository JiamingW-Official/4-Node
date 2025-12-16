# Economics Quiz - Real-time Multiplayer Quiz Application

A real-time multiplayer quiz application focused on economics questions. Players join via WebSocket, answer questions simultaneously, and compete on a live leaderboard.

## 🎯 Overview

This application enables multiple users to participate in a synchronized quiz session. The server manages game state, timing, and scoring, while clients connect via WebSocket to receive real-time updates and submit answers.

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite, CSS3
- **Backend**: Node.js, WebSocket (ws library)
- **Communication**: WebSocket protocol for real-time bidirectional communication
- **Deployment**: GitHub Pages (static frontend) + WebSocket server

## 📁 Project Structure

```
4-Node/
├── client/                 # React frontend application
│   ├── src/
│   │   ├── App.jsx        # Main React component
│   │   ├── App.css        # Application styles
│   │   └── main.jsx       # React entry point
│   ├── dist/              # Production build output
│   └── vite.config.js     # Vite configuration
├── server/                # Node.js WebSocket server
│   ├── server.js          # Main server logic
│   └── package.json       # Server dependencies
├── docs/                  # GitHub Pages deployment directory
└── deploy.ps1             # Deployment script
```

## 🔄 Code Walkthrough

### Backend Architecture (`server/server.js`)

#### 1. **Server Initialization**
```javascript
const server = new WebSocketServer({ port: PORT })
```
- Creates a WebSocket server listening on port 3001 (or `process.env.PORT`)
- Handles multiple concurrent client connections

#### 2. **Session State Management**
The server maintains a global session object that tracks:
- `phase`: Current game phase (`lobby`, `question`, `reveal`, `ended`)
- `questionIndex`: Index of the current question (0-9)
- `answers`: Map of `userId → { optionIndex, timestamp }`
- `scores`: Map of `userId → score`
- `endsAt`: Timestamp when the current question phase ends

#### 3. **Client Connection Flow**
```javascript
server.on('connection', (ws) => {
  const clientId = randomId()
  const color = `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`
  clients.set(ws, { clientId, color, name: '' })
  
  ws.send(JSON.stringify({ 
    type: 'init', 
    clientId, 
    color, 
    name, 
    state: deriveState(clientId) 
  }))
})
```

**What happens:**
1. New client connects → generates unique `clientId` and random HSL color
2. Client metadata stored in `clients` Map (WebSocket → metadata)
3. Server sends `init` message with client identity and current game state
4. Client receives initial state and can start interacting

#### 4. **Message Handling**
The server processes different message types:

- **`resume`**: Client reconnecting, wants to restore previous identity
- **`set-name`**: Client setting/changing their display name
- **`start`**: Host starts the quiz (moves from lobby to question 0)
- **`answer`**: Client submits an answer (only during `question` phase)
- **`next`**: Host advances to next question (only during `reveal` phase)

#### 5. **Question Lifecycle**

**Starting a Question:**
```javascript
const startQuestion = (index) => {
  session.phase = 'question'
  session.questionIndex = index
  session.answers = {}  // Clear previous answers
  session.endsAt = Date.now() + QUESTION_DURATION_MS  // 15 seconds
  broadcastState()
}
```

**Revealing Answers:**
```javascript
const revealQuestion = () => {
  session.phase = 'reveal'
  const question = currentQuestion()
  
  // Award points for correct answers
  Object.entries(session.answers).forEach(([userId, answer]) => {
    if (answer.optionIndex === question.correct) {
      session.scores[userId] = (session.scores[userId] || 0) + 1
    }
  })
  broadcastState()
}
```

**Auto-reveal Timer:**
```javascript
setInterval(() => {
  if (session.phase === 'question' && session.endsAt && Date.now() >= session.endsAt) {
    revealQuestion()
  }
}, 500)
```
- Checks every 500ms if time has expired
- Automatically transitions from `question` → `reveal` phase

#### 6. **State Broadcasting**
```javascript
const broadcastState = () => {
  for (const [client, meta] of clients) {
    if (client.readyState !== client.OPEN) continue
    client.send(JSON.stringify({ 
      type: 'state', 
      state: deriveState(meta.clientId) 
    }))
  }
}
```

`deriveState()` creates a personalized view for each client:
- Includes `youAnswered` field (their specific answer)
- Hides correct answer until `reveal` phase
- Includes all players, scores, and answer counts

### Frontend Architecture (`client/src/App.jsx`)

#### 1. **WebSocket Connection Management**
```javascript
useEffect(() => {
  const socket = new WebSocket(WS_URL)
  socketRef.current = socket
  
  socket.addEventListener('open', () => setConnection('connected'))
  socket.addEventListener('close', () => setConnection('disconnected'))
  socket.addEventListener('message', handleMessage)
  
  return () => socket.close()
}, [connVersion])
```

**Key points:**
- `connVersion` dependency allows reconnection by incrementing (triggers effect re-run)
- Connection state tracked in React state (`connecting`, `connected`, `disconnected`)
- Cleanup function closes socket on unmount

#### 2. **State Synchronization**
```javascript
const handleState = (state) => {
  setSession(state || emptySession())
  timeBaseRef.current = { 
    left: state?.timeLeft || 0, 
    syncedAt: Date.now() 
  }
}
```

**Time synchronization:**
- Server sends `timeLeft` (milliseconds remaining)
- Client stores this with current timestamp
- Client-side timer calculates remaining time: `timeLeft - elapsed`
- Updates every 250ms via `tick` state for smooth countdown

#### 3. **Identity Persistence**
```javascript
const lastIdentityRef = useRef(null)

// On init, try to resume previous identity
if (lastIdentityRef.current?.id) {
  socket.send(JSON.stringify({
    type: 'resume',
    clientId: lastIdentityRef.current.id,
    name: lastIdentityRef.current.name,
    color: lastIdentityRef.current.color,
  }))
}
```

**Why this matters:**
- If client refreshes/reconnects, they keep their name, color, and score
- Uses `useRef` to persist across re-renders
- Server validates and restores identity

#### 4. **UI State Machine**
The component renders different views based on state:

1. **Name Entry** (`!isNamed`): User must set a name before joining
2. **Lobby** (`session.phase === 'lobby'`): Waiting room, shows "Start" button
3. **Quiz** (`session.phase === 'question' | 'reveal'`): Active quiz interface
4. **Left State** (`hasLeft`): User disconnected, option to rejoin

#### 5. **Answer Submission**
```javascript
const answer = (idx) => send({ type: 'answer', optionIndex: idx })

// In render:
<button
  disabled={!canAnswer}
  onClick={() => answer(idx)}
>
```

**Validation:**
- `canAnswer` checks: has name, phase is `question`, hasn't answered yet
- Server also validates: phase, name, option index range
- Once answered, button disabled (one answer per question)

#### 6. **Real-time Updates**
- **Timer**: Visual countdown ring updates every 250ms
- **Answer counts**: Shows how many players chose each option (reveal phase)
- **Leaderboard**: Sorted by score, updates as players answer correctly
- **Connection status**: Visual indicator of WebSocket connection state

### Styling (`client/src/App.css`)

- **Design system**: CSS custom properties for colors, spacing
- **Typography**: Playfair Display (headings) + Space Grotesk (body)
- **Layout**: CSS Grid for responsive two-column layouts
- **Responsive**: Media queries for mobile (< 1024px) switch to single column

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm
- Git

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/JiamingW-Official/4-Node.git
cd 4-Node
```

2. **Install server dependencies**
```bash
cd server
npm install
```

3. **Install client dependencies**
```bash
cd ../client
npm install
```

### Running Locally

**Note**: The app now uses Render WebSocket server for all environments (local and production). No need to run a local server!

1. **Start the development client**
```bash
cd client
npm run dev
```
Client runs on `http://localhost:5173` (or `http://localhost:5174`)

2. **Open multiple browser tabs** to test multiplayer functionality

The app will automatically connect to `wss://four-node-2025.onrender.com`

### Building for Production

```bash
cd client
npm run build
```

This creates optimized files in `client/dist/`

## 📦 Deployment

### Quick Start (Automated)

This project includes GitHub Actions for automatic deployment. See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.

**Quick Steps:**

1. **Deploy WebSocket Server** (choose one):
   - **Railway** (Recommended): Connect GitHub repo, select `server` folder, deploy
   - **Render**: Create Web Service, set root directory to `server`
   - **Heroku**: Use the included `Procfile`

2. **Configure GitHub Secret**:
   - Go to repository Settings → Secrets and variables → Actions
   - Add secret: `VITE_WS_URL` = `wss://your-server-url.com`

3. **Enable GitHub Pages**:
   - Settings → Pages → Source: "GitHub Actions"
   - Push to `main` branch to trigger automatic deployment

### Manual Deployment

#### GitHub Pages (Frontend)

1. **Build the client**
```bash
cd client
VITE_WS_URL=wss://your-server-url.com npm run build
```

2. **Deploy to docs folder** (Windows PowerShell)
```powershell
.\deploy.ps1
```

3. **Commit and push**
```bash
git add docs/
git commit -m "Deploy to GitHub Pages"
git push origin main
```

4. **Enable GitHub Pages** in repository settings:
   - Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main` / `docs` folder

The app will be available at: `https://JiamingW-Official.github.io/4-Node/`

### WebSocket Server Deployment

The WebSocket server needs to run on a platform that supports persistent connections. See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed platform-specific instructions.

**Supported Platforms:**
- **Railway** (Recommended): Simple, free tier available
- **Render**: Free tier with WebSocket support
- **Heroku**: Requires credit card for free tier
- **DigitalOcean App Platform**: Paid plans

**Environment Variables:**
- `PORT`: Server port (automatically set by platform, default: 3001)

**Client Configuration:**
Set `VITE_WS_URL` environment variable before building:
```bash
# Windows PowerShell
$env:VITE_WS_URL="wss://your-server-domain.com"
npm run build

# Or set in GitHub Secrets for automatic deployment
```

## 🎮 How to Use

1. **Join**: Open the app, enter your name
2. **Lobby**: Wait for host to start (or start yourself if first)
3. **Answer**: Click an option within 15 seconds
4. **Reveal**: See correct answer and who chose what
5. **Next**: Host clicks "Next question" to continue
6. **Leaderboard**: View real-time scores on the right sidebar

## 🔧 Key Features

- ✅ Real-time synchronization via WebSocket
- ✅ Automatic timer with visual countdown
- ✅ Live answer statistics
- ✅ Persistent player identity
- ✅ Reconnection support
- ✅ Responsive design
- ✅ 10 economics questions included

## 📝 Notes

- Questions are hardcoded in `server/server.js` (lines 7-18)
- Each question has 4 options, one correct answer
- Players can join mid-game (missed questions don't score)
- Only one answer per question per player
- Host controls game flow (start, next question)

## 🤝 Contributing

Feel free to submit issues or pull requests!

## 📄 License

ISC

