import { AnimatePresence, motion } from 'framer-motion';
import { isDeadOnBoard, isJack, legalCellsOnBoard } from '../../../shared/game';
import type { Card } from '../../../shared/types';
import { sfx } from '../sounds';
import { useStore } from '../store';
import CardFace from './CardFace';

export default function Hand() {
  const game = useStore((s) => s.game);
  const selectedCard = useStore((s) => s.selectedCard);
  const selectCard = useStore((s) => s.selectCard);
  const playMove = useStore((s) => s.playMove);

  if (!game) return null;
  const me = game.players.find((p) => p.id === game.yourId);
  const myTurn =
    !game.winner && !game.stalemate && game.players[game.turn]?.id === game.yourId;
  const hand = game.yourHand;

  const noLegalMoves =
    myTurn &&
    me &&
    hand.every((card) => legalCellsOnBoard(game.board, me.team, card).length === 0);
  // exchanging a dead card is optional — offer it, but never block the pass
  const canExchange =
    noLegalMoves &&
    !game.deadExchangedThisTurn &&
    hand.some((card) => isDeadOnBoard(game.board, card));

  const onDeckClick = () => {
    if (game.settings.strictDraw && game.yourPendingDraws > 0) {
      sfx.draw();
      playMove({ type: 'draw' });
    }
  };

  return (
    <div className="hand-area">
      <div className="pile-zone">
        <div
          className={`deck-pile ${game.yourPendingDraws > 0 ? 'pulse-draw' : ''}`}
          onClick={onDeckClick}
          title={
            game.yourPendingDraws > 0
              ? 'Click to draw your card before the next player moves!'
              : `${game.deckCount} cards left`
          }
        >
          <div className="card-back" />
          <div className="card-back offset1" />
          <div className="card-back offset2" />
          <span className="deck-count">{game.deckCount}</span>
          {game.yourPendingDraws > 0 && <span className="draw-alert">DRAW!</span>}
        </div>
        <div className="discard-pile">
          {game.discardTop ? (
            <motion.div
              key={game.discardTop + game.deckCount}
              initial={{ y: -34, opacity: 0, rotate: -8 }}
              animate={{ y: 0, opacity: 1, rotate: 0 }}
              className="discard-card"
            >
              <CardFace card={game.discardTop} />
            </motion.div>
          ) : (
            <div className="discard-empty">discard</div>
          )}
        </div>
      </div>

      <div
        className={`hand ${myTurn ? 'my-turn' : ''}`}
        /* keyed by viewer so a pass-and-play handoff swaps hands instantly —
           no exit animation that could flash the previous player's cards */
        key={game.yourId}
        style={{ ['--n' as string]: hand.length } as React.CSSProperties}
      >
        <AnimatePresence mode="popLayout">
          {(() => {
            // stable keys: "card#occurrence" so unchanged cards never re-animate
            const seen = new Map<string, number>();
            return hand.map((card) => {
              const occ = seen.get(card) ?? 0;
              seen.set(card, occ + 1);
              return { card, key: `${card}#${occ}` };
            });
          })().map(({ card, key }, i) => {
            const dead = me ? isDeadOnBoard(game.board, card) : false;
            const selected = selectedCard === card;
            const mid = (hand.length - 1) / 2;
            const angle = (i - mid) * 3.2;
            return (
              <motion.div
                key={key}
                layout
                className={`hand-card ${selected ? 'selected' : ''} ${dead ? 'dead' : ''}`}
                style={{ zIndex: selected ? 40 : i }}
                initial={{ y: 90, opacity: 0 }}
                animate={{
                  y: selected ? -26 : 0,
                  opacity: 1,
                  rotate: selected ? 0 : angle,
                  scale: selected ? 1.1 : 1,
                }}
                exit={{ y: -70, opacity: 0, scale: 0.7 }}
                transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                whileHover={{ y: -18, scale: 1.06, rotate: 0 }}
                onClick={() => selectCard(selected ? null : card)}
              >
                <CardFace card={card} />
                {dead && <span className="dead-badge">DEAD</span>}
                {selected && dead && !isJack(card) && !game.deadExchangedThisTurn && myTurn && (
                  <button
                    className="exchange-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      playMove({ type: 'exchangeDead', card });
                      selectCard(null);
                    }}
                  >
                    ↻ Exchange
                  </button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="hand-side">
        {noLegalMoves && (
          <div className="stuck-actions">
            {canExchange && <span className="exchange-hint">Tap a dead card to exchange ↻</span>}
            <button className="btn btn-secondary" onClick={() => playMove({ type: 'pass' })}>
              No moves — pass
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
