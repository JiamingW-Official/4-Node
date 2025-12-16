import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

/**
 * WebSocket URL Configuration
 * 
 * This function determines which WebSocket server to connect to based on the environment.
 * - If VITE_WS_URL environment variable is set, use that (highest priority)
 * - Otherwise, use the Render WebSocket server for all environments
 * 
 * Why: This allows the same code to work in local development and production
 * without needing different builds. The environment variable can override the default.
 */
const getWebSocketURL = () => {
  // Use environment variable if set (highest priority)
  // This is useful for deployment where you might want to use a different server
  if (import.meta.env.VITE_WS_URL && import.meta.env.VITE_WS_URL !== 'wss://your-websocket-server.com') {
    return import.meta.env.VITE_WS_URL
  }
  
  // Use Render WebSocket server for all environments (local and production)
  // This simplifies deployment - same URL works everywhere
  return 'wss://four-node-2025.onrender.com'
}

const WS_URL = getWebSocketURL()
const QUESTION_MS = 15000 // 15 seconds per question

/**
 * Empty Session Template
 * 
 * This creates a default/empty game state. Used when:
 * - Initializing the app
 * - Resetting after leaving the game
 * - Handling connection errors
 * 
 * Structure:
 * - phase: Current game phase (lobby, question, reveal, ended)
 * - questionIndex: Which question we're on (-1 means no question active)
 * - timeLeft: Milliseconds remaining for current question
 * - question: The current question object (null if no question)
 * - counts: Array of how many players chose each option [A, B, C, D]
 * - answers: Object mapping player IDs to their answers
 * - scores: Object mapping player IDs to their total scores
 * - youAnswered: The current player's answer (undefined if not answered)
 * - players: Array of all connected players
 */
const emptySession = () => ({
  phase: 'lobby', // lobby | question | reveal | ended
  questionIndex: -1,
  totalQuestions: 0,
  timeLeft: 0,
  question: null,
  counts: [0, 0, 0, 0],
  totalAnswers: 0,
  answers: {},
  scores: {},
  youAnswered: undefined,
  players: [],
})

function App() {
  // ===== STATE MANAGEMENT =====
  // React state hooks store data that, when changed, cause the UI to re-render
  
  // Connection state: tracks WebSocket connection status
  // Values: 'connecting', 'connected', 'disconnected'
  const [connection, setConnection] = useState('connecting')
  
  // Player metadata: stores the current player's identity
  // - id: Unique identifier assigned by server
  // - color: Random color assigned by server for visual distinction
  // - name: Player's chosen display name
  const [meta, setMeta] = useState({ id: '', color: '', name: '' })
  
  // Game session state: the current game state received from server
  // This is the "source of truth" for what's happening in the quiz
  const [session, setSession] = useState(emptySession)
  
  // Name input: temporary storage for the name input field
  // Separate from meta.name because user might be typing before submitting
  const [nameInput, setNameInput] = useState('')
  
  // Connection version: used to force WebSocket reconnection
  // When this changes, the useEffect hook re-runs and creates a new connection
  const [connVersion, setConnVersion] = useState(0)
  
  // Tick counter: increments every 250ms to trigger UI updates
  // Used for smooth countdown timer animation
  const [tick, setTick] = useState(0)
  
  // Has left flag: tracks if user intentionally left the game
  // Shows different UI (rejoin screen) vs accidental disconnection
  const [hasLeft, setHasLeft] = useState(false)
  
  // Admin-related state
  const [showPasswordModal, setShowPasswordModal] = useState(false) // Show password input modal
  const [passwordInput, setPasswordInput] = useState(['', '', '', '']) // 4-digit password input
  const [isAdmin, setIsAdmin] = useState(false) // Whether current user is admin
  const [showAdminPanel, setShowAdminPanel] = useState(false) // Show admin control panel

  // ===== REFS (Persistent Values) =====
  // Refs store values that persist across re-renders but don't trigger re-renders when changed
  // Unlike state, changing a ref doesn't cause React to update the UI
  
  // Socket reference: stores the WebSocket connection object
  // We use a ref because we need to access it in event handlers and cleanup functions
  const socketRef = useRef(null)
  
  // Time base reference: stores timer synchronization data
  // - left: milliseconds remaining when last state was received
  // - syncedAt: timestamp when we received that state
  // Used to calculate remaining time locally without constant server updates
  const timeBaseRef = useRef({ left: 0, syncedAt: Date.now() })
  
  // Meta reference: stores player metadata in a ref for quick access
  // Used in event handlers where we need current value without waiting for state update
  const metaRef = useRef({ id: '', color: '', name: '' })
  
  // Last identity reference: stores previous identity for reconnection
  // When user refreshes or reconnects, we can restore their name, color, and score
  const lastIdentityRef = useRef(null)

  /**
   * WebSocket Connection Effect
   * 
   * This useEffect hook runs when the component mounts or when connVersion changes.
   * It sets up the WebSocket connection and handles all server communication.
   * 
   * How it works:
   * 1. Creates a new WebSocket connection to the server
   * 2. Sets up event listeners for connection events (open, close, error)
   * 3. Sets up message handler to process server updates
   * 4. Returns cleanup function to close connection when component unmounts
   * 
   * Why useEffect: We need to set up the connection when component loads,
   * and clean it up when component is removed or connection needs to be reset.
   */
  useEffect(() => {
    // If no WebSocket URL configured, mark as disconnected and exit
    if (!WS_URL) {
      setConnection('disconnected')
      return
    }
    
    // Create new WebSocket connection
    // WebSocket is a protocol that allows two-way communication between client and server
    // Unlike HTTP (request-response), WebSocket keeps a connection open for real-time updates
    const socket = new WebSocket(WS_URL)
    socketRef.current = socket // Store reference so we can access it later
    setConnection('connecting') // Update UI to show we're trying to connect

    /**
     * Handle State Updates from Server
     * 
     * This function processes game state received from the server.
     * The server sends the complete game state, and we update our local state to match.
     * 
     * Why this approach: The server is the "source of truth". All game logic happens
     * on the server, and clients just display what the server tells them. This ensures
     * all players see the same thing at the same time.
     */
    const handleState = (state) => {
      const prevPhase = session.phase // Remember previous phase to detect transitions
      
      // Update session state with new data from server
      // This triggers React to re-render the UI with new information
      setSession(state || emptySession())
      
      // Update timer synchronization
      // Server sends "timeLeft" (milliseconds remaining), we store it with current timestamp
      // Later we calculate: remaining = timeLeft - (now - syncedAt)
      // This allows smooth countdown without constant server updates
      timeBaseRef.current = { left: state?.timeLeft || 0, syncedAt: Date.now() }

      // Update player metadata if server has new information
      // This happens when server confirms our name or assigns us a color
      if (state?.players && metaRef.current.id) {
        const me = state.players.find((p) => p.id === metaRef.current.id)
        if (me && (me.name !== metaRef.current.name || me.color !== metaRef.current.color)) {
          // Update both ref (for quick access) and state (for UI updates)
          metaRef.current = { ...metaRef.current, name: me.name, color: me.color }
          setMeta((prev) => ({ ...prev, name: me.name, color: me.color }))
        }
      }
      
      // Reset admin panel when returning to lobby (but keep admin status)
      // This closes the admin panel when game resets, but user stays as admin
      if (state?.phase === 'lobby' && prevPhase !== 'lobby') {
        setShowAdminPanel(false)
      }
    }

    // ===== WEBSOCKET EVENT LISTENERS =====
    
    /**
     * Connection Opened
     * 
     * Fired when WebSocket connection is successfully established.
     * At this point, we can send and receive messages.
     */
    socket.addEventListener('open', () => {
      console.log('WebSocket connected to', WS_URL)
      setConnection('connected') // Update UI to show connected status
    })
    
    /**
     * Connection Closed
     * 
     * Fired when WebSocket connection is closed (server shutdown, network issue, etc.)
     * We update UI to show disconnected status.
     */
    socket.addEventListener('close', () => {
      console.log('WebSocket disconnected')
      setConnection('disconnected')
    })
    
    /**
     * Connection Error
     * 
     * Fired when there's an error with the WebSocket connection.
     * This could be network issues, server not running, etc.
     */
    socket.addEventListener('error', (error) => {
      console.error('WebSocket error:', error)
      setConnection('disconnected')
    })

    /**
     * Message Received from Server
     * 
     * This is where we receive all updates from the server.
     * Messages are JSON strings that we parse and handle based on their "type".
     * 
     * Message Types:
     * - 'init': Initial connection setup, includes our ID and current game state
     * - 'state': Game state update (new question, answer counts, scores, etc.)
     */
    socket.addEventListener('message', (event) => {
      let data
      try {
        // Parse JSON message from server
        // Server sends all data as JSON strings
        data = JSON.parse(event.data)
      } catch {
        // If message isn't valid JSON, ignore it
        return
      }

      // Handle different message types
      switch (data.type) {
        /**
         * Init Message
         * 
         * First message received when connecting. Contains:
         * - clientId: Our unique identifier
         * - color: Our assigned color
         * - name: Our current name (empty if not set)
         * - state: Current game state
         * 
         * After receiving init, we try to "resume" our previous identity
         * if we had one (from lastIdentityRef). This allows reconnection
         * without losing our name, color, and progress.
         */
        case 'init': {
          // Store our identity in both ref and state
          metaRef.current = { id: data.clientId, color: data.color, name: data.name }
          setMeta({ id: data.clientId, color: data.color, name: data.name })
          setNameInput((prev) => prev || '') // Keep existing input if we have one
          handleState(data.state) // Update game state
          setConnection('connected')
          
          // Try to resume previous identity
          // This allows reconnection without losing progress
          if (lastIdentityRef.current?.id) {
            // Send resume message to server with our previous identity
            socket.send(
              JSON.stringify({
                type: 'resume',
                clientId: lastIdentityRef.current.id,
                name: lastIdentityRef.current.name,
                color: lastIdentityRef.current.color,
              })
            )
            // Update our local state with previous identity
            metaRef.current = { ...metaRef.current, ...lastIdentityRef.current }
            setMeta((prev) => ({ ...prev, ...lastIdentityRef.current }))
          } else {
            // First time connecting, save our identity for future reconnections
            lastIdentityRef.current = metaRef.current
          }
          setHasLeft(false) // We're back in the game
          break
        }
        
        /**
         * State Update Message
         * 
         * Regular updates from server containing current game state.
         * This could be:
         * - New question started
         * - Answer counts updated
         * - Scores changed
         * - Phase changed (question -> reveal -> ended)
         */
        case 'state': {
          handleState(data.state)
          break
        }
        default:
          break
      }
    })

    /**
     * Cleanup Function
     * 
     * This function runs when:
     * - Component unmounts (user navigates away)
     * - connVersion changes (user clicks reconnect)
     * 
     * It closes the WebSocket connection to prevent memory leaks.
     */
    return () => socket.close()
  }, [connVersion]) // Re-run when connVersion changes (allows reconnection)

  /**
   * Timer Tick Effect
   * 
   * This creates an interval that runs every 250ms to update the tick counter.
   * The tick counter is used to trigger re-calculation of the countdown timer.
   * 
   * Why 250ms: Smooth enough for countdown animation, not too frequent to waste resources.
   * The actual countdown calculation uses the timeBaseRef to compute remaining time.
   */
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 250)
    return () => clearInterval(timer) // Cleanup: stop timer when component unmounts
  }, [])

  /**
   * Send Message to Server
   * 
   * Helper function to send JSON messages to the server via WebSocket.
   * 
   * How it works:
   * 1. Check if WebSocket is connected (readyState === OPEN)
   * 2. Convert JavaScript object to JSON string
   * 3. Send via WebSocket
   * 
   * Returns true if sent successfully, false otherwise.
   */
  const send = (payload) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      // WebSocket.OPEN means connection is ready to send/receive
      socket.send(JSON.stringify(payload))
      return true
    } else {
      // Connection not ready - log warning
      console.warn('WebSocket not connected, readyState:', socket?.readyState)
      return false
    }
  }

  /**
   * Countdown Timer Calculation
   * 
   * This calculates how much time is left for the current question.
   * 
   * How it works:
   * 1. Server sends "timeLeft" (milliseconds) when state updates
   * 2. We store it with current timestamp in timeBaseRef
   * 3. We calculate: elapsed = now - syncedAt
   * 4. Remaining = timeLeft - elapsed
   * 
   * Why this approach: Server sends timeLeft every few seconds, but we need
   * smooth countdown. By calculating locally, we get smooth updates without
   * constant server communication.
   * 
   * useMemo: Only recalculate when session.phase, questionIndex, or tick changes.
   * This prevents unnecessary calculations on every render.
   */
  const countdownMs = useMemo(() => {
    const elapsed = Date.now() - timeBaseRef.current.syncedAt // How much time has passed
    return Math.max(0, (timeBaseRef.current.left || 0) - elapsed) // Remaining time, never negative
  }, [session.phase, session.questionIndex, tick]) // Recalculate when these change

  // Convert milliseconds to seconds for display
  const secondsLeft = Math.ceil(countdownMs / 1000)
  
  // Calculate progress for visual timer (0 to 1, where 1 = time's up)
  const progress = session.phase === 'question' ? countdownMs / QUESTION_MS : 0
  
  // Get current player's answer
  const yourAnswer = session.youAnswered
  
  /**
   * Can Answer Check
   * 
   * Determines if the current player can submit an answer.
   * 
   * Conditions:
   * 1. Player must have a name (can't answer anonymously)
   * 2. Game must be in 'question' phase (not reveal or ended)
   * 3. Player hasn't already answered this question
   * 
   * This prevents:
   * - Answering before question starts
   * - Answering after time is up
   * - Answering multiple times
   */
  const canAnswer =
    Boolean(meta.name || metaRef.current.name) &&
    session.phase === 'question' &&
    typeof yourAnswer !== 'number'

  // Human-readable status text for display
  const statusCopy = {
    lobby: 'Waiting',
    question: 'Answering',
    reveal: 'Reveal',
    ended: 'Finished',
  }[session.phase] || '—'

  /**
   * Handle Name Submission
   * 
   * Called when user submits their name in the name input form.
   * 
   * Steps:
   * 1. Prevent form default submission (page refresh)
   * 2. Validate name is not empty
   * 3. Send 'set-name' message to server
   * 4. Update local state and refs
   * 5. Save to lastIdentityRef for reconnection
   */
  const handleNameSubmit = (event) => {
    event.preventDefault() // Prevent page refresh
    if (!nameInput.trim()) return // Don't submit empty names
    
    // Send name to server
    send({ type: 'set-name', name: nameInput.trim() })
    
    // Update local state immediately (optimistic update)
    metaRef.current = { ...metaRef.current, name: nameInput.trim() }
    lastIdentityRef.current = { ...metaRef.current, name: nameInput.trim() }
    setMeta((prev) => ({ ...prev, name: nameInput.trim() }))
  }

  /**
   * Start Game
   * 
   * Sends 'start' message to server to begin the quiz.
   * Server will move all players from lobby to question 1.
   */
  const startGame = () => {
    if (!meta.name) return // Must have a name to start
    send({ type: 'start' })
  }
  
  /**
   * Next Question
   * 
   * Sends 'next' message to server to advance to next question.
   * Only works when in 'reveal' phase (after current question is revealed).
   */
  const next = () => send({ type: 'next' })
  
  /**
   * Leave Game (Personal)
   * 
   * Closes WebSocket connection and resets local state.
   * This only affects the current user - others keep playing.
   */
  const goLobby = () => {
    setHasLeft(true) // Show "rejoin" screen
    const socket = socketRef.current
    if (socket) socket.close() // Close connection
    setSession(emptySession()) // Reset state
    setConnection('disconnected')
  }
  
  /**
   * Submit Answer
   * 
   * Sends answer choice to server.
   * 
   * @param {number} idx - The option index (0-3 for A-D)
   */
  const answer = (idx) => send({ type: 'answer', optionIndex: idx })
  
  /**
   * Reconnect
   * 
   * Forces WebSocket reconnection by incrementing connVersion.
   * This triggers the useEffect hook to create a new connection.
   */
  const reconnect = () => setConnVersion((n) => n + 1)
  
  /**
   * Return to Lobby (All Players)
   * 
   * Sends message to server to move all players back to lobby.
   * Only works when game has ended.
   */
  const returnToLobby = () => send({ type: 'return-to-lobby' })
  
  /**
   * Admin Restart Quiz
   * 
   * Sends admin restart command to server.
   * Server will reset game and start from question 1.
   * 
   * Security: Only works if user is authenticated as admin (isAdmin === true).
   * Server also validates the password.
   */
  const adminRestart = () => {
    // Check if user is admin
    if (!isAdmin) {
      alert('You are not an admin. Please login as admin first.')
      return
    }
    
    // Check WebSocket connection
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      alert('WebSocket connection is not open. Please reconnect.')
      reconnect()
      return
    }
    
    // Send restart command with password
    console.log('Sending admin-restart command')
    const sent = send({ type: 'admin-restart', password: '1234' })
    if (sent) {
      setShowAdminPanel(false) // Close admin panel
      console.log('Admin restart command sent successfully')
    } else {
      alert('Failed to send restart command. Please check your connection.')
    }
  }
  
  /**
   * Handle Password Input (4-digit code)
   * 
   * Processes input for the 4-digit password fields.
   * 
   * Features:
   * - Only allows numeric input (filters out letters)
   * - Auto-focuses next field when digit entered
   * - Auto-submits when all 4 digits entered
   * 
   * @param {number} index - Which input field (0-3)
   * @param {string} value - The input value
   */
  const handlePasswordInput = (index, value) => {
    // Only allow numeric input - remove any non-digit characters
    const numericValue = value.replace(/[^0-9]/g, '')
    if (numericValue.length > 1) return // Only allow single digit
    
    // Update password input array
    const newInput = [...passwordInput] // Copy array (don't mutate state directly)
    newInput[index] = numericValue
    setPasswordInput(newInput)
    
    // Auto-focus next input field when digit is entered
    // This creates a smooth "verification code" experience
    if (numericValue && index < 3) {
      const nextInput = document.getElementById(`password-${index + 1}`)
      if (nextInput) nextInput.focus()
    }
    
    // Auto-submit when all 4 digits are entered
    // This happens automatically - user doesn't need to click confirm
    if (index === 3 && numericValue) {
      // Use the updated newInput array directly (before state update completes)
      // This is important because setState is asynchronous
      const finalPassword = newInput.join('')
      if (finalPassword.length === 4) {
        setTimeout(() => {
          // Verify password and grant admin access
          if (finalPassword === '1234') {
            setIsAdmin(true) // Grant admin privileges
            setShowPasswordModal(false) // Close password modal
            setShowAdminPanel(true) // Open admin panel
            setPasswordInput(['', '', '', '']) // Clear password fields
          } else {
            alert('Incorrect password')
            setPasswordInput(['', '', '', '']) // Clear on wrong password
          }
        }, 150) // Small delay to ensure state updates
      }
    }
  }
  
  /**
   * Handle Manual Password Submit
   * 
   * Called when user clicks "Confirm" button in password modal.
   * Same logic as auto-submit, but triggered by button click.
   */
  const handlePasswordSubmitManual = () => {
    const password = passwordInput.join('') // Combine all 4 digits
    if (password === '1234') {
      setIsAdmin(true)
      setShowPasswordModal(false)
      setShowAdminPanel(true)
      setPasswordInput(['', '', '', ''])
    } else {
      alert('Incorrect password')
      setPasswordInput(['', '', '', ''])
    }
  }
  
  /**
   * Handle Password Input Keyboard Navigation
   * 
   * Allows backspace to move to previous field when current field is empty.
   * This improves UX - users can easily correct mistakes.
   */
  const handlePasswordKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !passwordInput[index] && index > 0) {
      // If backspace pressed on empty field, move to previous field
      const prevInput = document.getElementById(`password-${index - 1}`)
      if (prevInput) prevInput.focus()
    }
  }

  /**
   * Sort Players by Score
   * 
   * Creates a sorted array of players, highest score first.
   * Used for displaying the leaderboard.
   * 
   * How it works:
   * 1. Copy players array (don't mutate original)
   * 2. Sort by score (descending)
   * 3. If score doesn't exist, treat as 0
   */
  const sortedScores = [...(session.players || [])].sort(
    (a, b) => (session.scores[b.id] || 0) - (session.scores[a.id] || 0),
  )

  // Check if player has set a name
  const isNamed = Boolean(meta.name)

  // ===== UI RENDERING =====
  // React renders different UI based on current state
  
  /**
   * Left Game Screen
   * 
   * Shown when user intentionally leaves the game.
   * Allows them to rejoin without losing their identity.
   */
  if (hasLeft) {
    return (
      <div className="page">
        <header className="hero">
          <div>
            <p className="eyebrow">You left</p>
            <h1>Return to the game</h1>
            <p className="lede">Others keep playing. Rejoin to jump into the current question; missed ones stay unscored.</p>
          </div>
          <div className="actions stacked">
            <div className="control-row">
              <button className="primary" onClick={reconnect}>
                Rejoin
              </button>
            </div>
          </div>
        </header>
      </div>
    )
  }

  /**
   * Name Entry Screen
   * 
   * Shown when player hasn't set a name yet.
   * First step before joining the quiz.
   */
  if (!isNamed) {
    return (
      <div className="page">
        <header className="hero hero-vertical">
          <div>
            <p className="eyebrow">Pick a name</p>
            <h1>Economics Quiz</h1>
            <p className="lede">Save a name to join the live quiz. You will start from the current question; missed ones do not score.</p>
            
            {/* Show warning if WebSocket server not configured */}
            {!WS_URL && (
              <div style={{ 
                marginTop: '16px', 
                padding: '12px', 
                background: '#fff3cd', 
                border: '1px solid #ffc107', 
                borderRadius: '6px',
                color: '#856404'
              }}>
                <strong>⚠️ WebSocket Server Not Configured</strong>
                <p style={{ margin: '8px 0 0', fontSize: '14px' }}>
                  Unable to connect to Render WebSocket server.
                  <br />Make sure the server is running at: <code>wss://four-node-2025.onrender.com</code>
                  <br />Note: Render free tier services may take a few seconds to wake up after inactivity.
                </p>
              </div>
            )}
            
            {/* Show error if connection failed */}
            {connection === 'disconnected' && WS_URL && (
              <div style={{ 
                marginTop: '16px', 
                padding: '12px', 
                background: '#f8d7da', 
                border: '1px solid #dc3545', 
                borderRadius: '6px',
                color: '#721c24'
              }}>
                <strong>❌ Connection Failed</strong>
                <p style={{ margin: '8px 0 0', fontSize: '14px' }}>
                  Unable to connect to WebSocket server at <code>{WS_URL}</code>
                  <br />Make sure the server is running and accessible.
                </p>
              </div>
            )}
          </div>
          <div className="actions stacked">
            <form className="name-form" onSubmit={handleNameSubmit}>
              <label htmlFor="name-input">Name</label>
              <input
                id="name-input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Enter name"
                disabled={!WS_URL || connection === 'disconnected'}
              />
              <button type="submit" disabled={!nameInput.trim() || !WS_URL || connection === 'disconnected'}>
                Save
              </button>
            </form>
            <div className="control-row">
              <button className="ghost" onClick={reconnect} disabled={!WS_URL}>
                Reconnect
              </button>
            </div>
          </div>
        </header>
      </div>
    )
  }

  /**
   * Lobby Screen
   * 
   * Shown when game is in 'lobby' phase.
   * Players wait here until someone starts the game.
   */
  if (session.phase === 'lobby') {
    return (
      <div className="page">
        <header className="hero">
          <div>
            <p className="eyebrow">Lobby</p>
            <h1>Economics Quiz</h1>
            <p className="lede">Player: {meta.name}. Hit start to move everyone to question 1.</p>
            <div className="pill-row">
              <span className={`pill status ${connection}`}>{connection}</span>
              <span className="pill session">
                You <span className="swatch" style={{ background: meta.color }} /> {meta.name}
              </span>
              <span className="pill hint">WS: {WS_URL}</span>
            </div>
          </div>
          <div className="actions stacked">
            <div className="control-row">
              <button className="primary" onClick={startGame}>
                Start
              </button>
              <button className="ghost" onClick={reconnect}>
                Reconnect
              </button>
            </div>
          </div>
        </header>
      </div>
    )
  }

  /**
   * Quiz Screen (Main Game)
   * 
   * Shown during active quiz (question, reveal, or ended phases).
   * This is the main game interface with questions, answers, timer, and leaderboard.
   */
  return (
    <div className="page">
      {/* Admin Button - Top Right Corner */}
      {/* 
        This button allows access to admin features.
        - If not admin: opens password modal
        - If admin: toggles admin panel
      */}
      <button
        className="admin-restart-btn"
        onClick={() => {
          if (isAdmin) {
            setShowAdminPanel(!showAdminPanel) // Toggle admin panel
          } else {
            setShowPasswordModal(true) // Show password input
          }
        }}
        title={isAdmin ? "Admin Panel" : "Admin Login"}
      >
        Admin
      </button>
      
      {/* Admin Panel - Dropdown Menu */}
      {/* 
        Shown when admin clicks the Admin button.
        Contains controls for admin actions (restart quiz).
      */}
      {isAdmin && showAdminPanel && (
        <div className="admin-panel">
          <div className="admin-panel-content">
            <h4>Admin Panel</h4>
            <button className="primary" onClick={adminRestart}>
              Restart Quiz
            </button>
            <button className="ghost" onClick={() => setShowAdminPanel(false)}>
              Close
            </button>
          </div>
        </div>
      )}
      
      {/* Password Modal - Admin Authentication */}
      {/* 
        Modal dialog for entering admin password.
        Uses 4 separate input fields for a "verification code" style experience.
      */}
      {showPasswordModal && (
        <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Admin Verification</h3>
            <p>Enter 4-digit password</p>
            <div className="password-inputs">
              {[0, 1, 2, 3].map((index) => (
                <input
                  key={index}
                  id={`password-${index}`}
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={passwordInput[index]}
                  onChange={(e) => handlePasswordInput(index, e.target.value)}
                  onKeyDown={(e) => handlePasswordKeyDown(index, e)}
                  className="password-digit"
                  autoFocus={index === 0}
                />
              ))}
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowPasswordModal(false)} className="ghost">
                Cancel
              </button>
              <button onClick={handlePasswordSubmitManual} className="primary">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Header Section */}
      <header className="hero">
        <div>
          <p className="eyebrow">Live Quiz</p>
          <h1>Economics Quiz</h1>
          <div className="pill-row">
            <span className={`pill status ${connection}`}>{connection}</span>
            <span className="pill session">
              {statusCopy} · {session.questionIndex + 1}/{session.totalQuestions}
            </span>
            {/* Show admin badge if user is admin */}
            {isAdmin && <span className="pill" style={{ background: '#ffc107', color: '#000' }}>Admin</span>}
          </div>
        </div>
        <div className="actions stacked">
          <div className="control-row">
            {/* Next Question Button */}
            {/* 
              Disabled unless:
              - Game is in 'reveal' phase (current question is revealed)
              - Not on the last question
              
              On last question, button text changes to "View Results"
            */}
            <button 
              onClick={next} 
              disabled={session.phase !== 'reveal' || (session.questionIndex + 1 >= session.totalQuestions)}
            >
              {session.phase === 'reveal' && session.questionIndex + 1 >= session.totalQuestions 
                ? 'View Results' 
                : 'Next question'}
            </button>
            <button className="ghost" onClick={goLobby}>
              Leave (only me)
            </button>
          </div>
        </div>
      </header>

      {/* Main Game Area */}
      <main className="workspace">
        {/* Question Card - Left Side */}
        <section className="main-card">
          <div className="card-head">
            <div>
              <p className="label">Status</p>
              <h2>{statusCopy}</h2>
              <p className="muted">
                Answers {session.totalAnswers} · Online {session.players?.length || 0}
              </p>
            </div>
            
            {/* Visual Countdown Timer */}
            {/* 
              SVG circle that shows time remaining.
              - Background circle: full circle outline
              - Foreground circle: animated based on progress
              - Text: shows seconds remaining
              
              Progress calculation:
              - strokeDasharray creates a "dash" pattern
              - First value: length of visible dash (progress * circumference)
              - Second value: gap length
              - As progress decreases, less of the circle is visible
            */}
            <div className="timer">
              <svg viewBox="0 0 42 42" className="ring">
                <circle className="ring-bg" cx="21" cy="21" r="19" />
                <circle
                  className="ring-fg"
                  cx="21"
                  cy="21"
                  r="19"
                  strokeDasharray={`${Math.max(0, progress * 120)}, 200`}
                />
                <text x="21" y="23" textAnchor="middle" className="ring-text">
                  {session.phase === 'question' ? secondsLeft : '—'}
                </text>
              </svg>
              <div className="timer-copy">
                <p>Timer</p>
                <strong>{session.phase === 'question' ? `${secondsLeft}s` : 'Waiting'}</strong>
              </div>
            </div>
          </div>

          {/* Question Block */}
          <div className="question-block">
            {/* Show Question and Answer Options */}
            {session.question ? (
              <>
                <p className="prompt">{session.question.prompt}</p>
                <div className="options">
                  {/* Render each answer option as a button */}
                  {session.question.options?.map((opt, idx) => {
                    // Determine button state
                    const isCorrect = session.phase === 'reveal' && session.question.correct === idx
                    const isYours = yourAnswer === idx
                    const hasAnswered = typeof yourAnswer === 'number'
                    
                    return (
                      <button
                        key={idx}
                        className={`option ${isCorrect ? 'correct' : ''} ${isYours ? 'yours' : ''}`}
                        disabled={!canAnswer}
                        onClick={() => answer(idx)}
                      >
                        {/* Option letter (A, B, C, D) */}
                        <span className="option-letter">{String.fromCharCode(65 + idx)}</span>
                        
                        {/* Option text */}
                        <span className="option-text">{opt}</span>
                        
                        {/* Show answer count during reveal phase */}
                        {/* 
                          Displays how many players chose this option.
                          Format: "X / total players"
                        */}
                        {session.phase === 'reveal' && (
                          <span className="option-count">
                            {session.counts?.[idx] || 0} / {session.players?.length || 0}
                          </span>
                        )}
                        
                        {/* Show wrong mark if player chose incorrect answer */}
                        {!isCorrect && hasAnswered && isYours && session.phase === 'reveal' && (
                          <span className="option-result wrong">×</span>
                        )}
                        
                        {/* Show checkmark on correct answer */}
                        {isCorrect && session.phase === 'reveal' && <span className="option-result check">✓</span>}
                      </button>
                    )
                  })}
                </div>
              </>
            ) : session.phase === 'ended' || (session.phase === 'reveal' && session.questionIndex + 1 >= session.totalQuestions) ? (
              /* Finished Screen - Show Final Rankings */
              /* 
                Displayed when:
                - Game phase is 'ended', OR
                - On last question and in 'reveal' phase
                
                Shows all players ranked by score, with special highlighting for:
                - Current player (your own ranking)
                - Winner (top player)
              */
              <div className="finished-screen">
                <h2>🎉 Quiz Finished!</h2>
                <p className="finished-subtitle">Final Rankings</p>
                <div className="final-rankings">
                  {sortedScores.map((player, index) => (
                    <div key={player.id} className={`ranking-item ${meta.id === player.id ? 'me' : ''} ${index === 0 ? 'winner' : ''}`}>
                      <span className="rank-number">#{index + 1}</span>
                      <span className="dot" style={{ background: player.color }} />
                      <span className="name">{player.name || 'Unnamed'}</span>
                      <span className="score">{session.scores[player.id] || 0} / {session.totalQuestions}</span>
                      {index === 0 && <span className="badge">🏆 Winner</span>}
                    </div>
                  ))}
                </div>
                <div className="finished-actions">
                  {/* Return to Lobby - Available to all players */}
                  <button className="primary" onClick={returnToLobby}>
                    Return to Lobby
                  </button>
                  {/* Restart Quiz - Only available to admin */}
                  {isAdmin && (
                    <button className="primary" onClick={adminRestart}>
                      Restart Quiz
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="empty">
                <p>Finished. Go back to Lobby to start a new round.</p>
              </div>
            )}
          </div>
        </section>

        {/* Leaderboard Sidebar - Right Side */}
        <aside className="side">
          <div className="score-card">
            <div className="card-head">
              <div>
                <p className="label">Leaderboard</p>
                <h3>Who leads</h3>
              </div>
            </div>
            <ul className="score-list">
              {/* Render sorted list of players with scores */}
              {sortedScores.map((player, index) => (
                <li key={player.id} className={meta.id === player.id ? 'me' : ''}>
                  <span className="dot" style={{ background: player.color }} />
                  <span className="name">{player.name || 'Unnamed'}</span>
                  <span className="score">{session.scores[player.id] || 0} pts</span>
                  {index === 0 && <span className="badge">Top</span>}
                </li>
              ))}
              {!sortedScores.length && <li className="muted">No players yet</li>}
            </ul>
          </div>
        </aside>
      </main>
    </div>
  )
}

export default App
