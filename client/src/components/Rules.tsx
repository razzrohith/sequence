import { motion } from 'framer-motion';

export default function Rules({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <motion.div
        className="modal rules"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 22 }}
      >
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h2>How to play Sequence</h2>
        <ul>
          <li>
            <b>Goal:</b> make a <b>sequence</b> — five chips of your team's color in a row
            (horizontal, vertical or diagonal). <b>2 teams need 2 sequences</b> to win,{' '}
            <b>3 teams need 1</b>.
          </li>
          <li>
            <b>Your turn:</b> play a card from your hand, place a chip on one of that card's two
            spaces on the board, then a new card is drawn for you.
          </li>
          <li>
            <b>Corners are free</b> — they count for everyone, so a sequence touching a corner
            only needs 4 chips.
          </li>
          <li>
            <b>Two-eyed Jacks (♦ ♣) are wild:</b> place a chip on <i>any</i> open space.
          </li>
          <li>
            <b>One-eyed Jacks (♠ ♥) remove:</b> take away one opponent chip that isn't part of a
            completed sequence.
          </li>
          <li>
            <b>Dead card:</b> if both spaces for a card are covered, exchange it for a new card
            (once per turn) — click the card and choose <i>Exchange</i>.
          </li>
          <li>
            <b>Strict draw (optional):</b> you must click the deck to draw after playing. If the
            next player finishes first, you lose that card for the rest of the game!
          </li>
          <li>
            Two sequences may share <b>one</b> chip. Chips in a completed sequence are protected
            and glow gold.
          </li>
        </ul>
      </motion.div>
    </div>
  );
}
