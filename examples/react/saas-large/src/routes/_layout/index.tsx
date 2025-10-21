import { createFileRoute } from "@tanstack/react-router"
import { Flex, Text } from "@radix-ui/themes"

export const Route = createFileRoute(`/_layout/`)({
  component: IndexIndex,
})

function IndexIndex() {
  return (
    <Flex
      align="center"
      justify="center"
      style={{ height: `100%` }}
      direction="column"
      gap="2"
    >
      <Text size="4" color="gray">
        Select a product to view details
      </Text>
    </Flex>
  )
}
