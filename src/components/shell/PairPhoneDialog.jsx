import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PhoneStep } from "@/components/onboarding/PhoneStep";

/**
 * Pair an iPhone from anywhere in the app (the sidebar's workspace menu),
 * with the same QR offer and six-digit approval as onboarding and
 * Settings › Computers. Closing mid-offer leaves nothing paired.
 */
export function PairPhoneDialog({ api, open, onOpenChange, member }) {
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="pair-phone-dialog">
        <DialogTitle className="sr-only">Pair an iPhone</DialogTitle>
        <DialogDescription className="sr-only">Show a QR code for the Squad iPhone app, then approve the matching six digits.</DialogDescription>
        {open ? <PhoneStep inDialog api={api} member={member} onSkip={close} onFinish={close} /> : null}
      </DialogContent>
    </Dialog>
  );
}
