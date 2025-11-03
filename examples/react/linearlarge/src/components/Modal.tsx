import {
  Modal as AriaModal,
  Dialog,
  Heading,
  ModalOverlay,
  type ModalOverlayProps,
} from 'react-aria-components'

interface Props extends Omit<ModalOverlayProps, 'children'> {
  title?: string
  className?: string
  children?: React.ReactNode
  size?: 'normal' | 'large'
}

const sizeClasses = {
  large: 'w-[700px]',
  normal: 'w-[560px]',
}

export function Modal({
  title,
  size = 'normal',
  className = '',
  children,
  ...props
}: Props) {
  return (
    <ModalOverlay
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      {...props}
    >
      <AriaModal
        className={`flex flex-col overflow-hidden transform bg-white shadow-xl rounded-xl ${sizeClasses[size]} ${className}`}
      >
        <Dialog className="outline-none" aria-label={title || 'Dialog'}>
          {({ close }) => (
            <>
              {title && (
                <div className="flex items-center justify-between w-full px-6 py-4 border-b border-gray-200">
                  <Heading
                    slot="title"
                    className="text-sm font-semibold text-gray-700"
                  >
                    {title}
                  </Heading>
                  <button
                    type="button"
                    onClick={close}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    ✕
                  </button>
                </div>
              )}
              {children}
            </>
          )}
        </Dialog>
      </AriaModal>
    </ModalOverlay>
  )
}
