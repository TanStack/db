<template>
  <div ref="containerRef" class="tanstack-db-devtools-container" />
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { initializeDbDevtools, type DbDevtoolsConfig } from '@tanstack/db-devtools'

export interface VueDbDevtoolsProps extends DbDevtoolsConfig {
  // Vue-specific props can be added here
}

const props = withDefaults(defineProps<VueDbDevtoolsProps>(), {
  initialIsOpen: false,
  position: 'bottom-right',
  storageKey: 'tanstackDbDevtools',
})

const containerRef = ref<HTMLDivElement>()

onMounted(() => {
  // Initialize devtools registry
  initializeDbDevtools()

  if (containerRef.value) {
    // Import the core devtools dynamically to avoid SSR issues
    import('@tanstack/db-devtools').then(({ DbDevtools }) => {
      import('solid-js/web').then(({ render }) => {
        render(() => DbDevtools(props), containerRef.value!)
      })
    })
  }
})

// Watch for prop changes and update the devtools
watch(
  () => props,
  (newProps) => {
    if (containerRef.value) {
      // Re-render with new props
      import('@tanstack/db-devtools').then(({ DbDevtools }) => {
        import('solid-js/web').then(({ render }) => {
          render(() => DbDevtools(newProps), containerRef.value!)
        })
      })
    }
  },
  { deep: true }
)
</script>

<style scoped>
.tanstack-db-devtools-container {
  /* Container styles if needed */
}
</style>