import { Link } from 'react-router-dom'

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-content">
          <div className="footer-section">
            <h3>Learn</h3>
            <ul>
              <li><Link to="/learn">Introduction</Link></li>
              <li><Link to="/learn#quick-start">Quick Start</Link></li>
              <li><Link to="/query-driven-sync">Query-Driven Sync</Link></li>
              <li><a href="https://tanstack.com/db" target="_blank" rel="noopener noreferrer">Documentation</a></li>
            </ul>
          </div>
          <div className="footer-section">
            <h3>Community</h3>
            <ul>
              <li><a href="https://github.com/TanStack/db/discussions" target="_blank" rel="noopener noreferrer">Discussions</a></li>
              <li><a href="https://discord.com/invite/WrRKjPJ" target="_blank" rel="noopener noreferrer">Discord</a></li>
              <li><a href="https://twitter.com/tan_stack" target="_blank" rel="noopener noreferrer">Twitter</a></li>
              <li><a href="https://github.com/TanStack/db" target="_blank" rel="noopener noreferrer">GitHub</a></li>
            </ul>
          </div>
          <div className="footer-section">
            <h3>More</h3>
            <ul>
              <li><a href="https://tanstack.com/query" target="_blank" rel="noopener noreferrer">TanStack Query</a></li>
              <li><a href="https://tanstack.com/router" target="_blank" rel="noopener noreferrer">TanStack Router</a></li>
              <li><a href="https://tanstack.com/table" target="_blank" rel="noopener noreferrer">TanStack Table</a></li>
              <li><a href="https://tanstack.com" target="_blank" rel="noopener noreferrer">TanStack</a></li>
            </ul>
          </div>
          <div className="footer-section">
            <h3>Support</h3>
            <ul>
              <li><a href="https://github.com/sponsors/tannerlinsley" target="_blank" rel="noopener noreferrer">Become a Sponsor</a></li>
              <li><a href="mailto:partners@tanstack.com">Partnership Inquiries</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <p>Copyright © {new Date().getFullYear()} TanStack. Released under the MIT License.</p>
        </div>
      </div>
    </footer>
  )
}
