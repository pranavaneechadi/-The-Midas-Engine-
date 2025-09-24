# The Midas Engine 🪙📈
A modern stock analysis app with a premium animated UI. Explore top/worst performers, manage a watchlist, and visualize prices with SMA/EMA, RSI, MACD, and Bollinger Bands. Includes a TradingView-powered page for deep charting.

Highlights
- Advanced UI: glassmorphism, neon glows, animated backgrounds
- Charts: Chart.js financial candles + indicators, TradingView widget
- Data: Alpha Vantage quotes/history with smart caching and fallbacks
- Auth: JWT-based login/signup; user watchlist in MongoDB
- Pages: Login, Signup, Dashboard, TradingView, and a post-login chooser

Tech Stack
- Frontend: HTML, CSS (animated), vanilla JS, Chart.js + chartjs-chart-financial
- Backend: Node.js, Express, Mongoose
- DB: MongoDB
- APIs: Alpha Vantage


Key Pages
- login.html / signup.html: Auth with animated background
- choose.html: Choose Dashboard or TradingView after login
- index.html: Dashboard (top/worst, watchlist, multi-panel charts)
- tradingview.html: Trading terminal with dark theme widget

Security Notes
- Secrets are not hardcoded; use .env
- JWT stored in localStorage (consider HttpOnly cookies for stricter XSS defense)
- CORS currently allows localhost; make configurable for prod
