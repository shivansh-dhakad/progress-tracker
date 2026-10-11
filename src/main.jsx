import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { registerSW } from './reminders.jsx'
import './index.css'
import './theme.css'
registerSW()
createRoot(document.getElementById('root')).render(<App />)