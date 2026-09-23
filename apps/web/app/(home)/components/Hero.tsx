import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, CheckLine } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

type Props = {
  title: string;
  mobileTitle?: string;
  description: string;
  cta?: {
    primaryLabel: string;
    primaryHref: string;
    secondaryLabel?: string;
    secondaryHref?: string;
  };
};

const Hero = ({ title, mobileTitle, description, cta }: Props) => {
  return (
    <div
      lang="th"
      className="relative z-2 flex flex-col border-x border-t bg-fd-background/80 px-4 py-12 max-md:text-center md:px-12 md:pt-16 [.uwu_&]:hidden overflow-hidden"
    >
      {/* <div
        className="absolute inset-0 z-[-1] blur-2xl hidden dark:block"
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent, white, transparent)",
          background:
            "repeating-linear-gradient(65deg, var(--color-blue-500), var(--color-blue-500) 12px, color-mix(in oklab, var(--color-blue-600) 30%, transparent) 20px, transparent 200px)",
        }}
      />
      <div
        className="absolute inset-0 z-[-1] blur-2xl dark:hidden"
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent, white, transparent)",
          background:
            "repeating-linear-gradient(65deg, var(--color-purple-300), var(--color-purple-300) 12px, color-mix(in oklab, var(--color-blue-600) 30%, transparent) 20px, transparent 200px)",
        }}
      /> */}
      <div className="flex flex-col gap-4 md:flex-row">
        <div>
          <h1 className="mb-8 text-4xl font-semibold md:hidden">
            {mobileTitle || title}
          </h1>
          <h1 className="mb-8 max-w-[600px] text-4xl leading-snug max-md:hidden font-extrabold">
            {title}
          </h1>
          <p className="mb-8 text-fd-muted-foreground md:max-w-[80%] md:text-lg font-semibold">
            {description}
          </p>

          {cta && (
            <div className="inline-flex items-center gap-3 max-md:mx-auto">
              <Link
                href={cta.primaryHref}
                className={cn(
                  buttonVariants({ size: "lg", className: "rounded-full" })
                )}
              >
                {cta.primaryLabel}
                <ArrowRight />
              </Link>
              <a
                href={cta.secondaryHref}
                className={cn(
                  buttonVariants({
                    size: "lg",
                    variant: "outline",
                    className: "rounded-full bg-fd-background",
                  })
                )}
              >
                {cta.secondaryLabel}
                <CheckLine />
              </a>
            </div>
          )}
        </div>

        <div className="h-full m-auto hidden md:block">
          <Image
            src="/hero-image.webp"
            alt="image"
            width={500}
            height={500}
            loading="lazy"
          />
        </div>
      </div>
    </div>
  );
};

export default Hero;
