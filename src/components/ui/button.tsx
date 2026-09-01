import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { forwardRef, type ButtonHTMLAttributes } from "react"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "bg-violet text-white hover:bg-violet/90",
        outline:
          "border border-border bg-transparent hover:bg-panel",
        ghost: "hover:bg-panel text-text-dim hover:text-text",
        accent2: "bg-mint text-bg hover:bg-mint/90",
        gradient: "bg-gradient-to-r from-violet to-cyan text-bg hover:brightness-110",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
