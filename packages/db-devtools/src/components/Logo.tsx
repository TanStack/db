import { clsx as cx } from "clsx"
import { useStyles } from "../useStyles"

interface LogoProps {
  className?: () => string
  [key: string]: any
}

export function Logo(props: LogoProps) {
  const { className, ...rest } = props
  const styles = useStyles()
  return (
    <button {...rest} class={cx(styles().logo, className ? className() : ``)}>
      <div class={styles().tanstackLogo}>TANSTACK</div>
      <div class={styles().dbLogo}>TanStack DB v0</div>
    </button>
  )
}
