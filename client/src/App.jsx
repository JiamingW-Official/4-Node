import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001'
const QUESTION_MS = 15000

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
  const [connection, setConnection] = useState('connecting')
  const [meta, setMeta] = useState({ id: '', color: '', name: '' })
  const [session, setSession] = useState(emptySession)
  const [nameInput, setNameInput] = useState('')
  const [connVersion, setConnVersion] = useState(0)
  const [tick, setTick] = useState(0)
  const [hasLeft, setHasLeft] = useState(false)

  const socketRef = useRef(null)
  const timeBaseRef = useRef({ left: 0, syncedAt: Date.now() })
  const metaRef = useRef({ id: '', color: '', name: '' })
  const lastIdentityRef = useRef(null)

  useEffect(() => {
    const socket = new WebSocket(WS_URL)
    socketRef.current = socket
    setConnection('connecting')

    const handleState = (state) => {
      setSession(state || emptySession())
      timeBaseRef.current = { left: state?.timeLeft || 0, syncedAt: Date.now() }

      if (state?.players && metaRef.current.id) {
        const me = state.players.find((p) => p.id === metaRef.current.id)
        if (me && (me.name !== metaRef.current.name || me.color !== metaRef.current.color)) {
          metaRef.current = { ...metaRef.current, name: me.name, color: me.color }
          setMeta((prev) => ({ ...prev, name: me.name, color: me.color }))
        }
      }
    }

    socket.addEventListener('open', () => setConnection('connected'))
    socket.addEventListener('close', () => setConnection('disconnected'))
    socket.addEventListener('error', () => setConnection('disconnected'))

    socket.addEventListener('message', (event) => {
      let data
      try {
        data = JSON.parse(event.data)
      } catch {
        return
      }

      switch (data.type) {
        case 'init': {
          metaRef.current = { id: data.clientId, color: data.color, name: data.name }
          setMeta({ id: data.clientId, color: data.color, name: data.name })
          setNameInput((prev) => prev || '')
          handleState(data.state)
          setConnection('connected')
          // reclaim previous identity so rejoin does not reset progress
          if (lastIdentityRef.current?.id) {
            socket.send(
              JSON.stringify({
                type: 'resume',
                clientId: lastIdentityRef.current.id,
                name: lastIdentityRef.current.name,
                color: lastIdentityRef.current.color,
              })
            )
            metaRef.current = { ...metaRef.current, ...lastIdentityRef.current }
            setMeta((prev) => ({ ...prev, ...lastIdentityRef.current }))
          } else {
            lastIdentityRef.current = metaRef.current
          }
          setHasLeft(false)
          break
        }
        case 'state': {
          handleState(data.state)
          break
        }
        default:
          break
      }
    })

    return () => socket.close()
  }, [connVersion])

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 250)
    return () => clearInterval(timer)
  }, [])

  const send = (payload) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload))
    }
  }

  const countdownMs = useMemo(() => {
    const elapsed = Date.now() - timeBaseRef.current.syncedAt
    return Math.max(0, (timeBaseRef.current.left || 0) - elapsed)
  }, [session.phase, session.questionIndex, tick])

  const secondsLeft = Math.ceil(countdownMs / 1000)
  const progress = session.phase === 'question' ? countdownMs / QUESTION_MS : 0
  const yourAnswer = session.youAnswered
  const canAnswer =
    Boolean(meta.name || metaRef.current.name) &&
    session.phase === 'question' &&
    typeof yourAnswer !== 'number'

  const statusCopy = {
    lobby: 'Waiting',
    question: 'Answering',
    reveal: 'Reveal',
    ended: 'Finished',
  }[session.phase] || '—'

  const handleNameSubmit = (event) => {
    event.preventDefault()
    if (!nameInput.trim()) return
    send({ type: 'set-name', name: nameInput.trim() })
    metaRef.current = { ...metaRef.current, name: nameInput.trim() }
    lastIdentityRef.current = { ...metaRef.current, name: nameInput.trim() }
    setMeta((prev) => ({ ...prev, name: nameInput.trim() }))
  }

  const startGame = () => {
    if (!meta.name) return
    send({ type: 'start' })
  }
  const next = () => send({ type: 'next' })
  const goLobby = () => {
    setHasLeft(true)
    const socket = socketRef.current
    if (socket) socket.close()
    setSession(emptySession())
    setConnection('disconnected')
  }
  const answer = (idx) => send({ type: 'answer', optionIndex: idx })
  const reconnect = () => setConnVersion((n) => n + 1)

  const sortedScores = [...(session.players || [])].sort(
    (a, b) => (session.scores[b.id] || 0) - (session.scores[a.id] || 0),
  )

  const isNamed = Boolean(meta.name)

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

  // Name page
  if (!isNamed) {
    return (
      <div className="page">
        <header className="hero hero-vertical">
          <div>
            <p className="eyebrow">Pick a name</p>
            <h1>Economics Quiz</h1>
            <p className="lede">Save a name to join the live quiz. You will start from the current question; missed ones do not score.</p>
          </div>
          <div className="actions stacked">
            <form className="name-form" onSubmit={handleNameSubmit}>
              <label htmlFor="name-input">Name</label>
              <input
                id="name-input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Enter name"
              />
              <button type="submit" disabled={!nameInput.trim()}>
                Save
              </button>
            </form>
            <div className="control-row">
              <button className="ghost" onClick={reconnect}>
                Reconnect
              </button>
            </div>
          </div>
        </header>
      </div>
    )
  }

  // Lobby page
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

  // Quiz page
  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Live Quiz</p>
          <h1>Paper Quiz</h1>
          <div className="pill-row">
            <span className={`pill status ${connection}`}>{connection}</span>
            <span className="pill session">
              {statusCopy} · {session.questionIndex + 1}/{session.totalQuestions}
            </span>
          </div>
        </div>
        <div className="actions stacked">
          <div className="control-row">
            <button onClick={next} disabled={session.phase !== 'reveal'}>
              Next question
            </button>
            <button className="ghost" onClick={goLobby}>
              Leave (only me)
            </button>
          </div>
        </div>
      </header>

      <main className="workspace">
        <section className="main-card">
          <div className="card-head">
            <div>
              <p className="label">Status</p>
              <h2>{statusCopy}</h2>
              <p className="muted">
                Answers {session.totalAnswers} · Online {session.players?.length || 0}
              </p>
            </div>
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

          <div className="question-block">
            {session.question ? (
              <>
                <p className="prompt">{session.question.prompt}</p>
                <div className="options">
                  {session.question.options?.map((opt, idx) => {
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
                        <span className="option-letter">{String.fromCharCode(65 + idx)}</span>
                        <span className="option-text">{opt}</span>
                        {session.phase === 'reveal' && (
                          <span className="option-count">
                            {session.counts?.[idx] || 0} / {session.players?.length || 0}
                          </span>
                        )}
                        {!isCorrect && hasAnswered && isYours && session.phase === 'reveal' && (
                          <span className="option-result wrong">×</span>
                        )}
                        {isCorrect && session.phase === 'reveal' && <span className="option-result check">✓</span>}
                      </button>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="empty">
                <p>Finished. Go back to Lobby to start a new round.</p>
              </div>
            )}
          </div>
        </section>

        <aside className="side">
          <div className="score-card">
            <div className="card-head">
              <div>
                <p className="label">Leaderboard</p>
                <h3>Who leads</h3>
              </div>
            </div>
            <ul className="score-list">
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
