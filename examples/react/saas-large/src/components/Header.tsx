import { Link } from "@tanstack/react-router"
import { Flex, Heading } from "@radix-ui/themes"

export default function Header() {
  return (
    <Flex
      asChild
      justify="between"
      align="center"
      p="4"
      style={{ borderBottom: `1px solid var(--gray-a5)` }}
    >
      <header>
        <Link to="/">
          <Heading size="6">SaaS Large</Heading>
        </Link>
      </header>
    </Flex>
  )
}
