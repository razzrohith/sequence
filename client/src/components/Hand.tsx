import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { isDeadOnBoard, isJack, legalCellsOnBoard } from '../../../shared/game';
import type { Card } from '../../../shared/types';
import { sfx } from '../sounds';
import { useStore } from '../store';
import CardFace from './CardFace';

const SUIT_ORDER: Record<string, number> = { S: 0, H: 1, D: 2, C: 3 };
const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];

/** Optional tidy ordering of your hand. Jacks group at the end either way, since
 * they are the cards you play differently. */
function sortHand(hand: Card[], mode: 'off' | 'suit' | 'rank'): Card[] {
  if (mode === 'off') return hand;
  const rank = (c: Card) => RANK_ORDER.indexOf(c[0]);
  const suit = (c: Card) => SUIT_ORDER[c[1]] ?? 9;
  return [...hand].sort((a, b) => {
    const ja = isJack(a) ? 1 : 0;
    const jb = isJack(b) ? 1 : 0;
    if (ja !== jb) return ja - jb;
    return mode === 'suit'
      ? suit(a) - suit(b) || rank(a) - rank(b)
      : rank(a) - rank(b) || suit(a) - suit(b);
  });
}

export default function Hand() {
  const game = useStore((s) => s.game);
  const selectedCard = useStore((s) => s.selectedCard);
  const selectCard = useStore((s) => s.selectCard);
  const playMove = useStore((s) => s.playMove);
  const sortMode = useStore((s) => s.prefs.sortHand);
  const previewCardSet = useStore((s) => s.previewCardSet);
  // press and hold a card to light up its spaces without committing to it
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startHold = (card: string) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => previewCardSet(card), 350);
  };
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      previewCardSet(null);
    },
    [previewCardSet],
  );
  const endHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    previewCardSet(null);
  };

  if (!game) return null;
  const me = game.players.find((p) => p.id === game.yourId);
  const myTurn =
    !game.winner && !game.stalemate && game.players[game.turn]?.id === game.yourId;
  const hand = sortHand(game.yourHand, sortMode ?? 'off');

  const noLegalMoves =
    myTurn &&
    me &&
    hand.every((card) => legalCellsOnBoard(game.board, me.team, card, game.layout).length === 0);
  // dead cards you could swap (non-jacks whose two spaces are both taken)
  const deadCount = hand.filter(
    (card) => !isJack(card) && isDeadOnBoard(game.board, card, game.layout),
  ).length;
  const canSwapDead =
    myTurn &&
    game.settings.allowDeadExchange !== false &&
    !game.deadExchangedThisTurn &&
    deadCount > 0;
  // exchanging a dead card is optional, offer it, but never block the pass
  const canExchange = noLegalMoves && !game.deadExchangedThisTurn && deadCount > 0;

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
        /* keyed by viewer so a pass-and-play handoff swaps hands instantly -
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
            const dead = me ? isDeadOnBoard(game.board, card, game.layout) : false;
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
                onPointerDown={() => startHold(card)}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onPointerCancel={endHold}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`${card}${dead ? ', dead card' : ''}${selected ? ', selected' : ''}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectCard(selected ? null : card);
                  }
                }}
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
        {myTurn && deadCount > 0 && (
          <div className="dead-tools">
            <span className="dead-count">
              {deadCount} dead card{deadCount > 1 ? 's' : ''}
            </span>
            {canSwapDead && (
              <button
                className="btn btn-secondary btn-sm refresh-dead"
                onClick={() => {
                  sfx.draw();
                  playMove({ type: 'swapDead' });
                  selectCard(null);
                }}
                title="Swap every dead card for a fresh one"
              >
                ↻ Refresh {deadCount > 1 ? 'all' : ''}
              </button>
            )}
          </div>
        )}
        {noLegalMoves && (
          <div className="stuck-actions">
            {canExchange && <span className="exchange-hint">Tap a dead card to exchange ↻</span>}
            <button className="btn btn-secondary" onClick={() => playMove({ type: 'pass' })}>
              No moves, pass
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
