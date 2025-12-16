const { WebSocketServer } = require('ws')

const PORT = process.env.PORT || 3001
const QUESTION_DURATION_MS = 15000

// Quiz question bank (10 simple English)
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

const clients = new Map()
let session = {
  phase: 'lobby', // lobby | question | reveal | ended
  questionIndex: -1,
  endsAt: null,
  answers: {}, // userId -> { optionIndex, ts }
  scores: {}, // userId -> number
}

const randomId = () => Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)

const broadcast = (payload, exclude) => {
  const message = JSON.stringify(payload)
  for (const [client] of clients) {
    if (client.readyState === client.OPEN && client !== exclude) {
      client.send(message)
    }
  }
}

const currentQuestion = () =>
  questions[session.questionIndex] ? { ...questions[session.questionIndex] } : null

const calcCounts = () => {
  const counts = Array(4).fill(0)
  Object.values(session.answers).forEach(({ optionIndex }) => {
    if (Number.isInteger(optionIndex) && counts[optionIndex] !== undefined) counts[optionIndex] += 1
  })
  return counts
}

const deriveState = (viewerId) => {
  const question = currentQuestion()
  const counts = calcCounts()
  const now = Date.now()
  const timeLeft =
    session.phase === 'question' && session.endsAt ? Math.max(0, session.endsAt - now) : 0

  return {
    phase: session.phase,
    questionIndex: session.questionIndex,
    totalQuestions: questions.length,
    timeLeft,
    question: question
      ? {
          id: question.id,
          prompt: question.prompt,
          options: question.options,
          correct: session.phase === 'reveal' ? question.correct : null,
        }
      : null,
    counts,
    totalAnswers: Object.keys(session.answers).length,
    answers: session.answers,
    scores: session.scores,
    youAnswered: viewerId ? session.answers[viewerId]?.optionIndex : undefined,
    players: Array.from(clients.values()).map((c) => ({
      id: c.clientId,
      name: c.name,
      color: c.color,
    })),
  }
}

const broadcastState = () => {
  for (const [client, meta] of clients) {
    if (client.readyState !== client.OPEN) continue
    client.send(JSON.stringify({ type: 'state', state: deriveState(meta.clientId) }))
  }
}

const startQuestion = (index) => {
  session.phase = 'question'
  session.questionIndex = index
  session.answers = {}
  session.endsAt = Date.now() + QUESTION_DURATION_MS
  broadcastState()
}

const revealQuestion = () => {
  if (session.phase !== 'question') return
  session.phase = 'reveal'
  session.endsAt = null

  const question = currentQuestion()
  if (question) {
    Object.entries(session.answers).forEach(([userId, answer]) => {
      if (answer.optionIndex === question.correct) {
        session.scores[userId] = (session.scores[userId] || 0) + 1
      }
    })
  }
  broadcastState()
}

const nextQuestion = () => {
  if (session.questionIndex + 1 < questions.length) {
    startQuestion(session.questionIndex + 1)
  } else {
    session.phase = 'ended'
    session.endsAt = null
    broadcastState()
  }
}

const server = new WebSocketServer({ port: PORT })

server.on('connection', (ws) => {
  const clientId = randomId()
  const color = `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`
  const name = '' // force each client to choose a name
  clients.set(ws, { clientId, color, name })

  ws.send(JSON.stringify({ type: 'init', clientId, color, name, state: deriveState(clientId) }))

  ws.on('message', (message) => {
    let data
    try {
      data = JSON.parse(message.toString())
    } catch {
      return
    }

    const meta = clients.get(ws)
    if (!meta) return

    switch (data.type) {
      case 'resume': {
        if (typeof data.clientId === 'string' && data.clientId.trim().length > 4) {
          meta.clientId = data.clientId.trim()
        }
        if (typeof data.name === 'string' && data.name.trim()) {
          meta.name = data.name.trim().slice(0, 24)
        }
        if (typeof data.color === 'string' && data.color.trim()) {
          meta.color = data.color.trim()
        }
        broadcastState()
        break
      }
      case 'set-name': {
        if (typeof data.name === 'string' && data.name.trim()) {
          meta.name = data.name.trim().slice(0, 24)
          broadcastState()
        }
        break
      }
      case 'start': {
        if (!meta.name) break
        if (session.phase === 'lobby' || session.phase === 'ended') {
          session.scores = {}
          startQuestion(0)
        }
        break
      }
      case 'answer': {
        if (session.phase !== 'question') break
        if (!meta.name) break
        const optionIndex = Number(data.optionIndex)
        if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) break
        if (!session.answers[meta.clientId]) {
          session.answers[meta.clientId] = { optionIndex, ts: Date.now() }
          broadcastState()
        }
        break
      }
      case 'next': {
        if (session.phase === 'reveal') {
          nextQuestion()
        }
        break
      }
      default:
        break
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    broadcastState()
  })
})

setInterval(() => {
  if (session.phase === 'question' && session.endsAt && Date.now() >= session.endsAt) {
    revealQuestion()
  }
}, 500)

server.on('listening', () => {
  // eslint-disable-next-line no-console
  const protocol = process.env.NODE_ENV === 'production' ? 'wss' : 'ws'
  const host = process.env.HOST || 'localhost'
  console.log(`Quiz WebSocket server running on ${protocol}://${host}:${PORT}`)
})
