/**
 * Economics Quiz - WebSocket Server
 * 
 * This is the backend server that manages the quiz game state.
 * It uses WebSocket for real-time communication with all connected clients.
 * 
 * How it works:
 * 1. Server maintains the "source of truth" for game state
 * 2. Clients connect via WebSocket and receive state updates
 * 3. Clients send actions (answer, start, next) to server
 * 4. Server processes actions and broadcasts updated state to all clients
 * 
 * Why WebSocket instead of HTTP:
 * - HTTP is request-response (client asks, server answers)
 * - WebSocket is bidirectional (server can push updates anytime)
 * - This allows real-time updates without clients constantly polling
 */

const { WebSocketServer } = require('ws')

// Server Configuration
const PORT = process.env.PORT || 3001 // Use environment variable or default to 3001
const QUESTION_DURATION_MS = 15000 // 15 seconds per question

/**
 * Question Bank
 * 
 * Array of quiz questions. Each question has:
 * - id: Unique identifier
 * - prompt: The question text
 * - options: Array of 4 answer choices
 * - correct: Index of the correct answer (0-3)
 * 
 * This is the complete set of questions for the quiz.
 */
const questions = [
  { id: 'q1', prompt: 'What is inflation?', options: ['A general rise in prices', 'A drop in all prices', 'Only stock prices rising', 'Interest rates falling'], correct: 0 },
  { id: 'q2', prompt: 'GDP stands for?', options: ['Gross Domestic Product', 'Global Debt Position', 'Government Deposit Portfolio', 'General Demand Price'], correct: 0 },
  { id: 'q3', prompt: 'A budget is balanced when?', options: ['Spending is below revenue', 'Spending equals revenue', 'Spending is double revenue', 'There is no tax collected'], correct: 1 },
  { id: 'q4', prompt: 'A central bank mainly does what?', options: ['Prints textbooks', 'Manages money supply and interest rates', 'Sets grocery prices', 'Runs private banks'], correct: 1 },
  { id: 'q5', prompt: 'If demand rises and supply stays the same, price usually?', options: ['Goes up', 'Goes down', 'Stays the same', 'Becomes zero'], correct: 0 },
  { id: 'q6', prompt: 'Which of these is money?', options: ['Bank deposits', 'Movie tickets', 'Coupons', 'A promise on paper'], correct: 0 },
  { id: 'q7', prompt: 'The unemployment rate measures?', options: ['Everyone without a job', 'People not working and not looking', 'The share of the labor force looking for work', 'Only students'], correct: 2 },
  { id: 'q8', prompt: 'Trade can make countries better off because of?', options: ['Self-sufficiency', 'Comparative advantage', 'Zero imports', 'Equal wages everywhere'], correct: 1 },
  { id: 'q9', prompt: 'Higher interest rates usually make borrowing?', options: ['Cheaper', 'More expensive', 'Free', 'Impossible'], correct: 1 },
  { id: 'q10', prompt: 'Saving vs investing: which is true?', options: ['Saving never has risk', 'Investing can pay more but has risk', 'Both always lose money', 'Investing has no risk'], correct: 1 },
]

/**
 * Client Storage
 * 
 * Map that stores all connected clients.
 * Key: WebSocket connection object
 * Value: Client metadata (id, color, name)
 * 
 * Why Map instead of Array:
 * - Fast lookup by WebSocket object
 * - Easy to add/remove clients
 * - Can iterate over all clients for broadcasting
 */
const clients = new Map()

/**
 * Admin Password
 * 
 * Password required for admin actions (restart quiz).
 * In production, this should be stored as an environment variable.
 */
const ADMIN_PASSWORD = '1234'

/**
 * Game Session State
 * 
 * This is the "source of truth" for the entire game.
 * All clients receive updates based on this state.
 * 
 * Structure:
 * - phase: Current game phase (lobby, question, reveal, ended)
 * - questionIndex: Which question is currently active (-1 = no question)
 * - endsAt: Timestamp when current question phase ends (for auto-reveal)
 * - answers: Object mapping player IDs to their answers for current question
 * - scores: Object mapping player IDs to their total scores across all questions
 */
let session = {
  phase: 'lobby', // lobby | question | reveal | ended
  questionIndex: -1,
  endsAt: null,
  answers: {}, // userId -> { optionIndex, ts }
  scores: {}, // userId -> number
}

/**
 * Generate Random ID
 * 
 * Creates a unique identifier for each client.
 * Uses hexadecimal characters for compact representation.
 * 
 * @returns {string} Random 16-character hex string
 */
const randomId = () => Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)

/**
 * Broadcast Message to All Clients
 * 
 * Sends a message to all connected clients except optionally one.
 * 
 * How it works:
 * 1. Convert message object to JSON string
 * 2. Loop through all clients in the Map
 * 3. Check if client connection is open
 * 4. Send message to each client
 * 
 * @param {object} payload - Message to send
 * @param {WebSocket} exclude - Optional client to exclude from broadcast
 */
const broadcast = (payload, exclude) => {
  const message = JSON.stringify(payload) // Convert to JSON string
  for (const [client] of clients) {
    // Check if connection is open and not the excluded client
    if (client.readyState === client.OPEN && client !== exclude) {
      client.send(message) // Send message via WebSocket
    }
  }
}

/**
 * Get Current Question
 * 
 * Returns the question object for the current question index.
 * Returns null if no question is active.
 * 
 * @returns {object|null} Current question or null
 */
const currentQuestion = () =>
  questions[session.questionIndex] ? { ...questions[session.questionIndex] } : null

/**
 * Calculate Answer Counts
 * 
 * Counts how many players chose each option (A, B, C, D).
 * 
 * How it works:
 * 1. Create array of 4 zeros [0, 0, 0, 0]
 * 2. Loop through all answers
 * 3. Increment count for each option chosen
 * 
 * @returns {Array<number>} Array of counts [A, B, C, D]
 */
const calcCounts = () => {
  const counts = Array(4).fill(0) // Initialize with zeros
  Object.values(session.answers).forEach(({ optionIndex }) => {
    // Validate optionIndex is valid (0-3)
    if (Number.isInteger(optionIndex) && counts[optionIndex] !== undefined) {
      counts[optionIndex] += 1 // Increment count for this option
    }
  })
  return counts
}

/**
 * Derive State for Client
 * 
 * Creates a personalized view of game state for a specific client.
 * 
 * Why personalized:
 * - Hides correct answer until reveal phase
 * - Includes "youAnswered" field showing this client's answer
 * - Calculates time remaining based on server time
 * 
 * @param {string} viewerId - The client ID requesting the state
 * @returns {object} Complete game state object
 */
const deriveState = (viewerId) => {
  const question = currentQuestion() // Get current question
  const counts = calcCounts() // Calculate answer distribution
  const now = Date.now()
  
  // Calculate time remaining
  // If in question phase and timer is set, calculate remaining time
  // Otherwise return 0
  const timeLeft =
    session.phase === 'question' && session.endsAt ? Math.max(0, session.endsAt - now) : 0

  return {
    phase: session.phase,
    questionIndex: session.questionIndex,
    totalQuestions: questions.length,
    timeLeft, // Milliseconds remaining
    question: question
      ? {
          id: question.id,
          prompt: question.prompt,
          options: question.options,
          // Only reveal correct answer during reveal phase
          // This prevents cheating by inspecting network traffic
          correct: session.phase === 'reveal' ? question.correct : null,
        }
      : null,
    counts, // How many players chose each option
    totalAnswers: Object.keys(session.answers).length, // Total players who answered
    answers: session.answers, // All answers (for debugging/admin)
    scores: session.scores, // All player scores
    youAnswered: viewerId ? session.answers[viewerId]?.optionIndex : undefined, // This client's answer
    players: Array.from(clients.values()).map((c) => ({
      id: c.clientId,
      name: c.name,
      color: c.color,
    })), // List of all connected players
  }
}

/**
 * Broadcast State to All Clients
 * 
 * Sends current game state to all connected clients.
 * Each client receives a personalized view (with their own answer).
 * 
 * Called whenever game state changes:
 * - New question starts
 * - Player answers
 * - Question revealed
 * - Scores updated
 */
const broadcastState = () => {
  for (const [client, meta] of clients) {
    // Skip clients with closed connections
    if (client.readyState !== client.OPEN) continue
    
    // Send personalized state to each client
    client.send(JSON.stringify({ type: 'state', state: deriveState(meta.clientId) }))
  }
}

/**
 * Start a Question
 * 
 * Transitions game to question phase and starts the timer.
 * 
 * Steps:
 * 1. Set phase to 'question'
 * 2. Set question index
 * 3. Clear previous answers (new question = fresh start)
 * 4. Set timer end time (current time + question duration)
 * 5. Broadcast new state to all clients
 * 
 * @param {number} index - Question index (0-9)
 */
const startQuestion = (index) => {
  session.phase = 'question'
  session.questionIndex = index
  session.answers = {} // Clear answers for new question
  session.endsAt = Date.now() + QUESTION_DURATION_MS // Set timer
  broadcastState() // Notify all clients
}

/**
 * Reveal Question Answers
 * 
 * Transitions from question phase to reveal phase.
 * 
 * Steps:
 * 1. Change phase to 'reveal'
 * 2. Clear timer (no longer needed)
 * 3. Calculate scores (award points for correct answers)
 * 4. Broadcast updated state (now includes correct answer)
 * 
 * Scoring:
 * - Loop through all answers
 * - If answer matches correct option, add 1 point to player's score
 * - Scores persist across questions
 */
const revealQuestion = () => {
  if (session.phase !== 'question') return // Only reveal if in question phase
  session.phase = 'reveal'
  session.endsAt = null // Clear timer

  const question = currentQuestion()
  if (question) {
    // Award points for correct answers
    Object.entries(session.answers).forEach(([userId, answer]) => {
      if (answer.optionIndex === question.correct) {
        // Increment score (or initialize to 1 if first correct answer)
        session.scores[userId] = (session.scores[userId] || 0) + 1
      }
    })
  }
  broadcastState() // Send updated state with scores
}

/**
 * Move to Next Question
 * 
 * Advances to the next question or ends the game.
 * 
 * Logic:
 * - If more questions remain: start next question
 * - If last question: end the game
 * 
 * Called when host clicks "Next question" button.
 */
const nextQuestion = () => {
  if (session.questionIndex + 1 < questions.length) {
    // More questions - start next one
    startQuestion(session.questionIndex + 1)
  } else {
    // No more questions - end game
    session.phase = 'ended'
    session.endsAt = null
    broadcastState()
  }
}

/**
 * Create WebSocket Server
 * 
 * Starts the WebSocket server listening on the specified port.
 * This is the entry point for all client connections.
 */
const server = new WebSocketServer({ port: PORT })

/**
 * Handle New Client Connection
 * 
 * This event fires whenever a new client connects to the server.
 * 
 * Process:
 * 1. Generate unique ID and random color for client
 * 2. Store client in Map
 * 3. Send initial state to client
 * 4. Set up message handlers
 * 5. Set up disconnect handler
 */
server.on('connection', (ws) => {
  // Generate unique identifier for this client
  const clientId = randomId()
  
  // Generate random color for visual distinction
  // HSL format: hue (0-360), saturation (70%), lightness (55%)
  const color = `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`
  
  // Start with empty name - client must set it
  const name = ''
  
  // Store client in Map with metadata
  clients.set(ws, { clientId, color, name })

  // Send initial connection message
  // Client receives this and knows their ID, color, and current game state
  ws.send(JSON.stringify({ type: 'init', clientId, color, name, state: deriveState(clientId) }))

  /**
   * Handle Messages from Client
   * 
   * Processes actions sent by clients.
   * 
   * Message Types:
   * - 'resume': Client reconnecting, wants to restore identity
   * - 'set-name': Client setting/changing their name
   * - 'start': Host starting the quiz
   * - 'answer': Client submitting an answer
   * - 'next': Host advancing to next question
   * - 'admin-restart': Admin restarting the quiz
   * - 'return-to-lobby': Returning all players to lobby
   */
  ws.on('message', (message) => {
    let data
    try {
      // Parse JSON message from client
      data = JSON.parse(message.toString())
    } catch {
      // Invalid JSON - ignore message
      return
    }

    // Get client metadata
    const meta = clients.get(ws)
    if (!meta) return // Client not found (shouldn't happen)

    // Handle different message types
    switch (data.type) {
      /**
       * Resume Identity
       * 
       * Client reconnecting and wants to restore previous identity.
       * This allows reconnection without losing name, color, and score.
       * 
       * Security: Validates that clientId, name, and color are valid strings.
       */
      case 'resume': {
        // Update client ID if provided and valid
        if (typeof data.clientId === 'string' && data.clientId.trim().length > 4) {
          meta.clientId = data.clientId.trim()
        }
        // Update name if provided
        if (typeof data.name === 'string' && data.name.trim()) {
          meta.name = data.name.trim().slice(0, 24) // Limit to 24 characters
        }
        // Update color if provided
        if (typeof data.color === 'string' && data.color.trim()) {
          meta.color = data.color.trim()
        }
        // Broadcast updated state (includes restored identity)
        broadcastState()
        break
      }
      
      /**
       * Set Name
       * 
       * Client setting or changing their display name.
       * 
       * Validation:
       * - Must be non-empty string
       * - Limited to 24 characters
       */
      case 'set-name': {
        if (typeof data.name === 'string' && data.name.trim()) {
          meta.name = data.name.trim().slice(0, 24)
          broadcastState() // Notify all clients of name change
        }
        break
      }
      
      /**
       * Start Game
       * 
       * Host starting the quiz from lobby.
       * 
       * Requirements:
       * - Player must have a name
       * - Game must be in lobby or ended phase
       * 
       * Action:
       * - Resets scores (fresh game)
       * - Starts question 1
       */
      case 'start': {
        if (!meta.name) break // Must have name
        if (session.phase === 'lobby' || session.phase === 'ended') {
          session.scores = {} // Reset scores
          session.answers = {} // Clear answers
          startQuestion(0) // Start from first question
        }
        break
      }
      
      /**
       * Submit Answer
       * 
       * Client submitting an answer to current question.
       * 
       * Validation:
       * - Must be in question phase
       * - Player must have a name
       * - Option index must be valid (0-3)
       * - Player can only answer once per question
       * 
       * Storage:
       * - Stores answer with timestamp
       * - Timestamp allows tracking answer speed (future feature)
       */
      case 'answer': {
        if (session.phase !== 'question') break // Only accept during question phase
        if (!meta.name) break // Must have name
        const optionIndex = Number(data.optionIndex)
        // Validate option index is 0, 1, 2, or 3
        if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) break
        // Only allow one answer per question per player
        if (!session.answers[meta.clientId]) {
          session.answers[meta.clientId] = { optionIndex, ts: Date.now() }
          broadcastState() // Update all clients with new answer count
        }
        break
      }
      
      /**
       * Next Question
       * 
       * Host advancing to next question.
       * 
       * Requirements:
       * - Must be in reveal phase (current question must be revealed)
       * 
       * Special handling:
       * - If on last question, end game instead of starting new question
       */
      case 'next': {
        if (session.phase === 'reveal') {
          // Check if this is the last question
          if (session.questionIndex + 1 >= questions.length) {
            // Last question - end game
            session.phase = 'ended'
            session.endsAt = null
            broadcastState()
          } else {
            // More questions - advance
            nextQuestion()
          }
        }
        break
      }
      
      /**
       * Admin Restart
       * 
       * Admin restarting the quiz from any point.
       * 
       * Security:
       * - Requires password authentication
       * - Password checked on server (client-side check is not secure)
       * 
       * Action:
       * - Resets all game state
       * - Starts from question 1 immediately
       * - Clears all scores and answers
       */
      case 'admin-restart': {
        // eslint-disable-next-line no-console
        console.log('Admin restart requested, password:', data.password)
        if (data.password === ADMIN_PASSWORD) {
          // Reset all data and start from question 1
          session.phase = 'question'
          session.questionIndex = 0
          session.endsAt = Date.now() + QUESTION_DURATION_MS
          session.answers = {}
          session.scores = {}
          // eslint-disable-next-line no-console
          console.log('Admin restart executed - starting from question 1')
          broadcastState()
        } else {
          // eslint-disable-next-line no-console
          console.log('Admin restart failed: incorrect password')
        }
        break
      }
      
      /**
       * Return to Lobby
       * 
       * Moving all players back to lobby after game ends.
       * 
       * Requirements:
       * - Game must be in ended phase
       * 
       * Action:
       * - Resets game state to lobby
       * - Clears scores and answers
       * - Players can start a new game
       */
      case 'return-to-lobby': {
        if (session.phase === 'ended') {
          session.phase = 'lobby'
          session.questionIndex = -1
          session.endsAt = null
          session.answers = {}
          session.scores = {}
          broadcastState()
        }
        break
      }
      default:
        break
    }
  })

  /**
   * Handle Client Disconnect
   * 
   * Fired when client closes connection (closes browser, navigates away, etc.)
   * 
   * Action:
   * - Remove client from Map
   * - Broadcast updated state (removes player from list)
   */
  ws.on('close', () => {
    clients.delete(ws) // Remove from active clients
    broadcastState() // Update all clients (player list changed)
  })
})

/**
 * Auto-Reveal Timer
 * 
 * Checks every 500ms if question time has expired.
 * 
 * How it works:
 * 1. Check if in question phase
 * 2. Check if timer end time has passed
 * 3. If yes, automatically reveal the question
 * 
 * Why setInterval:
 * - Server needs to check timer independently
 * - Can't rely on client-side timers (clients might disconnect)
 * - Ensures questions are revealed even if host doesn't click "Next"
 * 
 * Interval: 500ms (checks twice per second)
 * - Frequent enough for accurate timing
 * - Not too frequent to waste resources
 */
setInterval(() => {
  if (session.phase === 'question' && session.endsAt && Date.now() >= session.endsAt) {
    revealQuestion() // Time's up - reveal answers
  }
}, 500)

/**
 * Server Started Event
 * 
 * Fired when server successfully starts listening.
 * Logs connection information for debugging.
 */
server.on('listening', () => {
  // eslint-disable-next-line no-console
  const protocol = process.env.NODE_ENV === 'production' ? 'wss' : 'ws'
  const host = process.env.HOST || 'localhost'
  console.log(`Quiz WebSocket server running on ${protocol}://${host}:${PORT}`)
})
