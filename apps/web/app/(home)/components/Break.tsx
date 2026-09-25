const Break = ({ word, meaning }: { word: string; meaning: string }) => {
  return (
    <div
      className="relative overflow-hidden border-x border-t px-8 py-16 sm:py-24"
      style={{
        backgroundImage:
          "radial-gradient(circle at center, var(--color-primary), var(--color-fd-secondary), var(--color-fd-secondary), var(--color-fd-secondary), var(--color-fd-secondary), var(--color-fd-background) 30%)",
      }}
    >
      <h2
        lang="th"
        className="text-center leading-snug text-2xl font-semibold sm:text-3xl"
      >
        {word}
        <br />
        {meaning}
      </h2>
    </div>
  );
};

export default Break;
