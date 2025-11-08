import { Link } from 'react-router-dom'

export function Navigation() {
  return (
    <nav className="nav">
      <div className="container nav-content">
        <Link to="/" className="nav-logo">
          <span>TanStack</span> DB
        </Link>
        <ul className="nav-links">
          <li><Link to="/learn">Learn</Link></li>
          <li><Link to="/query-driven-sync">Query-Driven Sync</Link></li>
          <li><Link to="/code">Code</Link></li>
          <li><Link to="/community">Community</Link></li>
          <li>
            <a
              href="https://github.com/TanStack/db"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </li>
        </ul>
      </div>
    </nav>
  )
}
