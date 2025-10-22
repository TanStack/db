import { createFileRoute } from "@tanstack/react-router"
import { useLiveQuery } from "@tanstack/react-db"
import { Badge, Flex, Heading, Text } from "@radix-ui/themes"
import { getProductByIdLiveQuery } from "../../db/queries"

export const Route = createFileRoute(`/_layout/$productId`)({
  component: ProductDetail,
  loader: async ({ params }) => {
    await getProductByIdLiveQuery(params.productId).preload()
  },
})

function ProductDetail() {
  const { productId } = Route.useParams()

  const { data: products = [], isLoading } = useLiveQuery(
    () => getProductByIdLiveQuery(productId),
    [productId]
  )

  if (isLoading) {
    return (
      <Flex
        align="center"
        justify="center"
        style={{ height: `100%` }}
        direction="column"
        gap="2"
      >
        <Text size="4" color="gray">
          Loading...
        </Text>
      </Flex>
    )
  }

  const product = products[0]

  return (
    <>
      <Flex direction="column" gap="1">
        <Heading size="5">{product.name}</Heading>
        <Text size="2" color="gray">
          {product.brand}
        </Text>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="6" weight="bold">
          ${product.price.toFixed(2)}
        </Text>
        <Flex align="center" gap="2">
          <Text size="2">⭐ {product.rating}/5</Text>
          <Badge color={product.inStock ? `green` : `red`}>
            {product.inStock ? `In Stock` : `Out of Stock`}
          </Badge>
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Heading size="3">Category</Heading>
        <Badge size="2">{product.category}</Badge>
      </Flex>

      <Flex direction="column" gap="2">
        <Heading size="3">Description</Heading>
        <Text size="2">{product.description}</Text>
      </Flex>

      {product.tags.length > 0 && (
        <Flex direction="column" gap="2">
          <Heading size="3">Tags</Heading>
          <Flex gap="2" wrap="wrap">
            {product.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </Flex>
        </Flex>
      )}
    </>
  )
}
