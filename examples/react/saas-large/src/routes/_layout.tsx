import {
  Link,
  Outlet,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { useLiveInfiniteQuery } from "@tanstack/react-db"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  Badge,
  Card,
  Checkbox,
  Flex,
  Heading,
  Separator,
  Text,
  TextField,
} from "@radix-ui/themes"
import { Search } from "lucide-react"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"
import { getProductsInfiniteQuery } from "../db/queries"

const searchSchema = z.object({
  q: z.string().default(``),
  categories: z.array(z.string()).default([]),
  ratings: z.array(z.number()).default([]),
  inStockOnly: z.boolean().default(false),
})

export const Route = createFileRoute(`/_layout`)({
  component: App,
  validateSearch: zodValidator(searchSchema),
  loader: async ({ deps: { search } }) => {
    await getProductsInfiniteQuery({
      q: search.q,
      categories: search.categories,
      ratings: search.ratings,
      inStockOnly: search.inStockOnly,
    }).preload()
  },
  loaderDeps: ({ search }) => ({ search }),
})

function App() {
  const search = Route.useSearch()
  const navigate = useNavigate()

  const searchQuery = search.q
  const selectedCategories = new Set(search.categories)
  const selectedRatings = new Set(search.ratings)
  const showInStockOnly = search.inStockOnly

  const {
    data: filteredProducts = [],
    fetchNextPage,
    hasNextPage,
  } = useLiveInfiniteQuery(
    getProductsInfiniteQuery({
      q: search.q,
      categories: search.categories,
      ratings: search.ratings,
      inStockOnly: search.inStockOnly,
    }),
    {
      pageSize: 50,
      getNextPageParam: (lastPage, _allPages, lastPageParam) =>
        lastPage.length === 50 ? lastPageParam + 50 : undefined,
    }
  )

  const parentRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: filteredProducts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100,
    overscan: 25,
  })

  // Fetch next page when scrolling near the bottom
  useEffect(() => {
    const virtualItems = rowVirtualizer.getVirtualItems()
    if (virtualItems.length === 0) {
      return
    }
    const lastItem = virtualItems[virtualItems.length - 1]

    console.log({ lastItem, hasNextPage, filteredProducts })

    if (lastItem.index >= filteredProducts.length - 1 && hasNextPage) {
      console.log(`fetching`)
      fetchNextPage()
    }
  }, [
    hasNextPage,
    fetchNextPage,
    filteredProducts.length,
    rowVirtualizer.getVirtualItems(),
  ])

  const categories = [
    `Electronics`,
    `Clothing`,
    `Home`,
    `Books`,
    `Toys`,
    `Sports`,
  ]

  const toggleCategory = (category: string) => {
    navigate({
      search: (prev) => ({
        ...prev,
        categories: prev.categories.includes(category)
          ? prev.categories.filter((c) => c !== category)
          : [...prev.categories, category],
      }),
    })
  }

  const toggleRating = (rating: number) => {
    navigate({
      search: (prev) => ({
        ...prev,
        ratings: prev.ratings.includes(rating)
          ? prev.ratings.filter((r) => r !== rating)
          : [...prev.ratings, rating],
      }),
    })
  }

  return (
    <Flex style={{ height: `calc(100vh - 73px)` }}>
      <Flex
        direction="column"
        gap="4"
        p="4"
        style={{
          width: `240px`,
          borderRight: `1px solid var(--gray-a5)`,
          overflow: `auto`,
        }}
      >
        <Heading size="4">Filters</Heading>

        <Flex direction="column" gap="2">
          <Heading size="2">Category</Heading>
          <Flex direction="column" gap="2">
            {categories.map((category) => (
              <Text key={category} size="2" asChild>
                <label
                  style={{ display: `flex`, alignItems: `center`, gap: `8px` }}
                >
                  <Checkbox
                    checked={selectedCategories.has(category)}
                    onCheckedChange={() => toggleCategory(category)}
                  />
                  {category}
                </label>
              </Text>
            ))}
          </Flex>
        </Flex>

        <Separator size="4" />

        <Flex direction="column" gap="2">
          <Heading size="2">Rating</Heading>
          <Flex direction="column" gap="2">
            {[5, 4, 3, 2, 1].map((rating) => (
              <Text key={rating} size="2" asChild>
                <label
                  style={{ display: `flex`, alignItems: `center`, gap: `8px` }}
                >
                  <Checkbox
                    checked={selectedRatings.has(rating)}
                    onCheckedChange={() => toggleRating(rating)}
                  />
                  {rating} Stars
                </label>
              </Text>
            ))}
          </Flex>
        </Flex>

        <Separator size="4" />

        <Text size="2" asChild>
          <label style={{ display: `flex`, alignItems: `center`, gap: `8px` }}>
            <Checkbox
              checked={showInStockOnly}
              onCheckedChange={(checked) =>
                navigate({
                  search: (prev) => ({
                    ...prev,
                    inStockOnly: checked === true,
                  }),
                })
              }
            />
            In Stock Only
          </label>
        </Text>
      </Flex>

      <Flex direction="column" style={{ flex: 1, overflow: `hidden` }}>
        <Flex
          direction="column"
          gap="2"
          p="4"
          style={{ borderBottom: `1px solid var(--gray-a5)` }}
        >
          <TextField.Root
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) =>
              navigate({
                search: (prev) => ({ ...prev, q: e.target.value }),
              })
            }
            size="3"
          >
            <TextField.Slot>
              <Search size={16} />
            </TextField.Slot>
          </TextField.Root>
          <Flex justify="between" align="center">
            <Text size="2" color="gray">
              {filteredProducts.length} product
              {filteredProducts.length === 1 ? `` : `s`}
              {` `}
              {searchQuery ||
              selectedCategories.size > 0 ||
              selectedRatings.size > 0 ||
              showInStockOnly
                ? `found`
                : `loaded`}
            </Text>
            {hasNextPage && (
              <Text size="1" color="gray">
                Scroll for more...
              </Text>
            )}
          </Flex>
        </Flex>

        <Flex
          ref={parentRef}
          style={{
            flex: 1,
            overflow: `auto`,
          }}
        >
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: `100%`,
              position: `relative`,
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const product = filteredProducts[virtualRow.index]
              return (
                <Link
                  key={virtualRow.key}
                  to="/$productId"
                  params={{ productId: product.id }}
                  search={(prev) => prev}
                  style={{ textDecoration: `none`, color: `inherit` }}
                >
                  <Card
                    style={{
                      position: `absolute`,
                      top: 0,
                      left: 0,
                      width: `99%`,
                      transform: `translateY(${virtualRow.start}px)`,
                      cursor: `pointer`,
                    }}
                    m="1"
                    variant="surface"
                  >
                    <Flex justify="between" align="start">
                      <Flex direction="column" gap="2">
                        <Heading size="3">{product.name}</Heading>
                        <Text size="2" color="gray">
                          {product.brand} • {product.category}
                        </Text>
                        <Flex gap="1">
                          {product.tags.map((tag) => (
                            <Badge key={tag} size="1">
                              {tag}
                            </Badge>
                          ))}
                        </Flex>
                      </Flex>
                      <Flex direction="column" align="end" gap="1">
                        <Text size="4" weight="bold">
                          ${product.price.toFixed(2)}
                        </Text>
                        <Text size="1" color="gray">
                          ⭐ {product.rating}/5
                        </Text>
                      </Flex>
                    </Flex>
                  </Card>
                </Link>
              )
            })}
          </div>
        </Flex>
      </Flex>

      <Flex
        direction="column"
        gap="4"
        p="4"
        style={{
          width: `400px`,
          borderLeft: `1px solid var(--gray-a5)`,
          overflow: `auto`,
        }}
      >
        <Outlet />
      </Flex>
    </Flex>
  )
}
