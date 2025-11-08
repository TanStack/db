export function Community() {
  return (
    <>
      <section className="hero" style={{ paddingTop: '4rem' }}>
        <div className="container">
          <h1>Community</h1>
          <p className="tagline">
            Join the TanStack DB community
          </p>
          <p className="subtitle">
            Connect with other developers, get help, and share your projects
          </p>
        </div>
      </section>

      <section className="features">
        <div className="container">
          <h2>Get Involved</h2>
          <div className="feature-grid">
            <div className="feature-card">
              <h3>💬 Discord</h3>
              <p>
                Join our Discord server to chat with the community, ask questions, and get real-time help from other developers and maintainers.
              </p>
              <a
                href="https://discord.com/invite/WrRKjPJ"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                Join Discord →
              </a>
            </div>
            <div className="feature-card">
              <h3>💡 GitHub Discussions</h3>
              <p>
                Share ideas, ask questions, and discuss TanStack DB features on GitHub Discussions. A great place for longer-form conversations.
              </p>
              <a
                href="https://github.com/TanStack/db/discussions"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                Join Discussions →
              </a>
            </div>
            <div className="feature-card">
              <h3>🐛 Issue Tracker</h3>
              <p>
                Found a bug or have a feature request? Open an issue on GitHub and help make TanStack DB better.
              </p>
              <a
                href="https://github.com/TanStack/db/issues"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                Report Issues →
              </a>
            </div>
            <div className="feature-card">
              <h3>🐦 Twitter</h3>
              <p>
                Follow @tan_stack on Twitter for updates, announcements, and tips about TanStack DB and the entire TanStack ecosystem.
              </p>
              <a
                href="https://twitter.com/tan_stack"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                Follow on Twitter →
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="code-section">
        <div className="container">
          <h2>Contributing</h2>
          <p className="description">
            TanStack DB is open source and we welcome contributions from the community
          </p>
          <div className="two-column" style={{ marginTop: '3rem' }}>
            <div className="feature-card">
              <h3>Code Contributions</h3>
              <p>
                We welcome pull requests! Whether it's fixing bugs, adding features, or improving documentation,
                your contributions make TanStack DB better for everyone.
              </p>
              <ul style={{ marginTop: '1rem', paddingLeft: '1.5rem', color: 'var(--color-text-muted)' }}>
                <li>Fork the repository on GitHub</li>
                <li>Create a feature branch</li>
                <li>Make your changes with tests</li>
                <li>Submit a pull request</li>
              </ul>
              <a
                href="https://github.com/TanStack/db/blob/main/CONTRIBUTING.md"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                Contributing Guide →
              </a>
            </div>
            <div className="feature-card">
              <h3>Documentation</h3>
              <p>
                Help improve our documentation by fixing typos, clarifying explanations, or adding examples.
                Great documentation makes TanStack DB accessible to everyone.
              </p>
              <ul style={{ marginTop: '1rem', paddingLeft: '1.5rem', color: 'var(--color-text-muted)' }}>
                <li>Fix typos and improve clarity</li>
                <li>Add code examples</li>
                <li>Write tutorials and guides</li>
                <li>Translate documentation</li>
              </ul>
              <a
                href="https://github.com/TanStack/db/tree/main/docs"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                Edit Docs →
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="features" style={{ background: 'var(--color-background)' }}>
        <div className="container">
          <h2>Community Resources</h2>
          <div className="feature-grid">
            <div className="feature-card">
              <h3>📚 Blog Posts</h3>
              <p>
                Read articles and tutorials about TanStack DB from the community and core team members.
              </p>
              <a
                href="https://tanstack.com/blog"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                Read the Blog →
              </a>
            </div>
            <div className="feature-card">
              <h3>🎥 Videos & Talks</h3>
              <p>
                Watch conference talks, tutorials, and walkthroughs about TanStack DB and related technologies.
              </p>
            </div>
            <div className="feature-card">
              <h3>🛠️ Community Projects</h3>
              <p>
                Explore projects built with TanStack DB by the community. Get inspired and learn from real-world examples.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="highlight-section">
        <div className="container">
          <h2>Support TanStack</h2>
          <div className="highlight-content">
            <p>
              TanStack DB is built and maintained by dedicated open source contributors.
              Your sponsorship helps ensure the project's sustainability and continued development.
            </p>
            <div style={{ marginTop: '3rem', textAlign: 'center' }}>
              <a
                href="https://github.com/sponsors/tannerlinsley"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ fontSize: '1.2rem', padding: '1.25rem 2.5rem' }}
              >
                Become a Sponsor
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="code-section">
        <div className="container">
          <h2>Partners</h2>
          <p className="description">
            TanStack DB partners help push the boundaries of what's possible
          </p>
          <div className="feature-grid">
            <div className="feature-card">
              <h3>Electric SQL</h3>
              <p>
                Real-time sync for Postgres. Electric SQL provides the Electric DB Collection adapter
                for seamless integration with TanStack DB.
              </p>
              <a
                href="https://electric-sql.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                Learn more →
              </a>
            </div>
            <div className="feature-card">
              <h3>Prisma</h3>
              <p>
                Next-generation ORM for Node.js and TypeScript. Use Prisma with TanStack DB for type-safe database access.
              </p>
              <a
                href="https://www.prisma.io?utm_source=tanstack&via=tanstack"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                Learn more →
              </a>
            </div>
            <div className="feature-card">
              <h3>Cloudflare</h3>
              <p>
                Deploy your TanStack DB applications on Cloudflare's global network with Workers and Pages.
              </p>
              <a
                href="https://www.cloudflare.com?utm_source=tanstack"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                Learn more →
              </a>
            </div>
            <div className="feature-card">
              <h3>Become a Partner</h3>
              <p>
                Interested in partnering with TanStack DB? We're looking for partners to join our mission
                and build amazing things together.
              </p>
              <a
                href="mailto:partners@tanstack.com?subject=TanStack DB Partnership"
                style={{ display: 'inline-block', marginTop: '1rem' }}
              >
                Let's chat →
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="hero" style={{ paddingTop: '4rem', paddingBottom: '6rem', background: 'var(--color-background)' }}>
        <div className="container">
          <h2 style={{ fontSize: '2.5rem', marginBottom: '1.5rem' }}>Join the TanStack Ecosystem</h2>
          <p className="subtitle" style={{ marginBottom: '2rem' }}>
            TanStack DB is part of the larger TanStack ecosystem of tools for building modern web applications.
          </p>
          <div className="btn-group">
            <a href="https://tanstack.com" className="btn btn-primary">
              Explore TanStack
            </a>
            <a
              href="https://github.com/TanStack"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
