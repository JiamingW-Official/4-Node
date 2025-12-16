import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

// Use Render WebSocket server for all environments
const getWebSocketURL = () => {
  // Use environment variable if set (highest priority)
  if (import.meta.env.VITE_WS_URL && import.meta.env.VITE_WS_URL !== 'wss://your-websocket-server.com') {
    return import.meta.env.VITE_WS_URL
  }
  
  // Use Render WebSocket server for all environments (local and production)
  return 'wss://four-node-2025.onrender.com'
}

const WS_URL = getWebSocketURL()
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
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [passwordInput, setPasswordInput] = useState(['', '', '', ''])
  const [isAdmin, setIsAdmin] = useState(false)
  const [showAdminPanel, setShowAdminPanel] = useState(false)

  const socketRef = useRef(null)
  const timeBaseRef = useRef({ left: 0, syncedAt: Date.now() })
  const metaRef = useRef({ id: '', color: '', name: '' })
  const lastIdentityRef = useRef(null)

  useEffect(() => {
    if (!WS_URL) {
      setConnection('disconnected')
      return
    }
    
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
      
      // Reset admin status when returning to lobby
      if (state?.phase === 'lobby') {
        setIsAdmin(false)
        setShowAdminPanel(false)
      }
    }

    socket.addEventListener('open', () => {
      console.log('WebSocket connected to', WS_URL)
      setConnection('connected')
    })
    socket.addEventListener('close', () => {
      console.log('WebSocket disconnected')
      setConnection('disconnected')
    })
    socket.addEventListener('error', (error) => {
      console.error('WebSocket error:', error)
      setConnection('disconnected')
    })

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
      return true
    } else {
      console.warn('WebSocket not connected, readyState:', socket?.readyState)
      return false
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
  const returnToLobby = () => send({ type: 'return-to-lobby' })
  const adminRestart = () => {
    if (!isAdmin) {
      alert('You are not an admin. Please login as admin first.')
      return
    }
    
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      alert('WebSocket connection is not open. Please reconnect.')
      reconnect()
      return
    }
    
    console.log('Sending admin-restart command')
    const sent = send({ type: 'admin-restart', password: '1234' })
    if (sent) {
      setShowAdminPanel(false)
    } else {
      alert('Failed to send restart command. Please check your connection.')
    }
  }
  
  
  const handlePasswordInput = (index, value) => {
    // Only allow numeric input
    const numericValue = value.replace(/[^0-9]/g, '')
    if (numericValue.length > 1) return
    
    const newInput = [...passwordInput]
    newInput[index] = numericValue
    setPasswordInput(newInput)
    
    // Auto-focus next input
    if (numericValue && index < 3) {
      const nextInput = document.getElementById(`password-${index + 1}`)
      if (nextInput) nextInput.focus()
    }
    
    // Auto-submit when all 4 digits are entered
    if (index === 3 && numericValue) {
      // Use the updated newInput array directly (before state update)
      const finalPassword = newInput.join('')
      if (finalPassword.length === 4) {
        setTimeout(() => {
          // Verify password and submit
          if (finalPassword === '1234') {
            setIsAdmin(true)
            setShowPasswordModal(false)
            setShowAdminPanel(true)
            setPasswordInput(['', '', '', ''])
          } else {
            alert('Incorrect password')
            setPasswordInput(['', '', '', ''])
          }
        }, 150)
      }
    }
  }
  
  const handlePasswordSubmitManual = () => {
    const password = passwordInput.join('')
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
  
  const handlePasswordKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !passwordInput[index] && index > 0) {
      const prevInput = document.getElementById(`password-${index - 1}`)
      if (prevInput) prevInput.focus()
    }
  }

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
      {/* Admin Button - Top Right */}
      <button
        className="admin-restart-btn"
        onClick={() => {
          if (isAdmin) {
            setShowAdminPanel(!showAdminPanel)
          } else {
            setShowPasswordModal(true)
          }
        }}
        title={isAdmin ? "Admin Panel" : "Admin Login"}
      >
        Admin
      </button>
      
      {/* Admin Panel */}
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
      
      {/* Password Modal */}
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
      
      <header className="hero">
        <div>
          <p className="eyebrow">Live Quiz</p>
          <h1>Economics Quiz</h1>
          <div className="pill-row">
            <span className={`pill status ${connection}`}>{connection}</span>
            <span className="pill session">
              {statusCopy} · {session.questionIndex + 1}/{session.totalQuestions}
            </span>
            {isAdmin && <span className="pill" style={{ background: '#ffc107', color: '#000' }}>Admin</span>}
          </div>
        </div>
        <div className="actions stacked">
          <div className="control-row">
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
            ) : session.phase === 'ended' || (session.phase === 'reveal' && session.questionIndex + 1 >= session.totalQuestions) ? (
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
                  <button className="primary" onClick={returnToLobby}>
                    Return to Lobby
                  </button>
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
