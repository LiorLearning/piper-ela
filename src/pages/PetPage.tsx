import React, { useState, useEffect, useMemo } from 'react';
import { useCoins } from '@/pages/coinSystem';
import { ttsService } from '@/lib/tts-service';
import { useTTSSpeaking } from '@/hooks/use-tts-speaking';
import { usePetData } from '@/lib/pet-data-service';

type Props = {};

type ActionStatus = 'happy' | 'sad' | 'neutral';

interface ActionButton {
  id: string;
  icon: string;
  status: ActionStatus;
  label: string;
}

export function PetPage({}: Props): JSX.Element {
  // Use shared coin system
  const { coins, spendCoins, hasEnoughCoins, setCoins } = useCoins();
  
  // Use shared pet data system
  const { careLevel, ownedPets, audioEnabled, setCareLevel, addOwnedPet, setAudioEnabled, isPetOwned, getCoinsSpentForCurrentStage, getPetCoinsSpent, addPetCoinsSpent, getSleepCoinsSpent, addSleepCoinsSpent } = usePetData();
  
  // Den and accessories state (stored in localStorage)
  const [ownedDens, setOwnedDens] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('owned_dens');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  
  const [ownedAccessories, setOwnedAccessories] = useState<{[key: string]: string[]}>(() => {
    try {
      const stored = localStorage.getItem('owned_accessories');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  
  // Helper functions for dens and accessories
  const isDenOwned = (petType: string) => ownedDens.includes(`${petType}_den`);
  const isAccessoryOwned = (petType: string, accessoryId: string) => {
    return ownedAccessories[petType]?.includes(accessoryId) || false;
  };
  
  const purchaseDen = (petType: string, cost: number) => {
    if (!hasEnoughCoins(cost)) return false;
    spendCoins(cost);
    const newOwnedDens = [...ownedDens, `${petType}_den`];
    setOwnedDens(newOwnedDens);
    localStorage.setItem('owned_dens', JSON.stringify(newOwnedDens));
    
    // Force immediate update of action states and thoughts
    setTimeout(() => {
      setActionStates(getActionStates());
      // Reset last spoken message to ensure new den thoughts are spoken
      setLastSpokenMessage('');
    }, 100);
    
    return true;
  };
  
  const purchaseAccessory = (petType: string, accessoryId: string, cost: number) => {
    if (!hasEnoughCoins(cost)) return false;
    spendCoins(cost);
    const newAccessories = { ...ownedAccessories };
    if (!newAccessories[petType]) newAccessories[petType] = [];
    newAccessories[petType].push(accessoryId);
    setOwnedAccessories(newAccessories);
    localStorage.setItem('owned_accessories', JSON.stringify(newAccessories));
    return true;
  };
  
  // State for which pet is currently being displayed
  const [currentPet, setCurrentPet] = useState('cat'); // Default to cat
  
  // Local state for UI interactions
  const [showHeartAnimation, setShowHeartAnimation] = useState(false);
  const [previousCoins, setPreviousCoins] = useState(coins);
  const [previousCoinsSpentForStage, setPreviousCoinsSpentForStage] = useState(0);
  const [showPetShop, setShowPetShop] = useState(false);
  const [lastSpokenMessage, setLastSpokenMessage] = useState('');
  
  // Image loading debounce state
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [imageLoadTimeout, setImageLoadTimeout] = useState<NodeJS.Timeout | null>(null);
  const [currentAction, setCurrentAction] = useState<'food' | 'sleep' | null>(null);
  
  // Image preloading for faster transitions
  const [preloadedImages, setPreloadedImages] = useState<Set<string>>(new Set());
  
  // Pet store state
  const [selectedStorePet, setSelectedStorePet] = useState('cat'); // Which pet's store section is shown
  const [storeRefreshTrigger, setStoreRefreshTrigger] = useState(0); // Trigger to refresh store data
  
  // Get current sleep coins spent for the current pet
  const getCurrentSleepCoinsSpent = () => getSleepCoinsSpent(currentPet);
  
  // Streak system for dog evolution unlocks - based on consecutive calendar days (US timezone)
  const [currentStreak, setCurrentStreak] = useState(() => {
    try {
      const streakData = localStorage.getItem('pet_feeding_streak_data');
      if (streakData) {
        const parsed = JSON.parse(streakData);
        return Math.max(0, parsed.streak || 0);
      }
      return 0;
    } catch {
      return 0;
    }
  });

  // Get current date in US timezone (Eastern Time)
  const getCurrentUSDate = () => {
    const now = new Date();
    const usDate = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
    return usDate.toDateString(); // Returns format like "Mon Jan 01 2024"
  };

  // Load and validate streak data
  const getStreakData = () => {
    try {
      const stored = localStorage.getItem('pet_feeding_streak_data');
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to parse streak data:', error);
    }
    return { streak: 0, lastFeedDate: null, feedDates: [] };
  };

  // Save streak data to localStorage
  const saveStreakData = (streakData: { streak: number; lastFeedDate: string; feedDates: string[] }) => {
    try {
      localStorage.setItem('pet_feeding_streak_data', JSON.stringify(streakData));
      setCurrentStreak(streakData.streak);
    } catch (error) {
      console.warn('Failed to save streak data:', error);
    }
  };

  // Update streak based on feeding date
  const updateStreak = () => {
    const currentDate = getCurrentUSDate();
    const streakData = getStreakData();
    
    // If already fed today, don't update streak
    if (streakData.lastFeedDate === currentDate) {
      return streakData.streak;
    }

    let newStreak = streakData.streak;
    const feedDates = [...(streakData.feedDates || [])];

    // Add today's date to feed dates
    if (!feedDates.includes(currentDate)) {
      feedDates.push(currentDate);
    }

    // Check if this continues a streak
    if (streakData.lastFeedDate) {
      const lastDate = new Date(streakData.lastFeedDate);
      const today = new Date(currentDate);
      const daysDifference = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysDifference === 1) {
        // Consecutive day - increment streak
        newStreak = streakData.streak + 1;
      } else if (daysDifference > 1) {
        // Gap in feeding - reset streak to 1
        newStreak = 1;
      }
      // If daysDifference === 0, it means same day (already handled above)
    } else {
      // First time feeding
      newStreak = 1;
    }

    const newStreakData = {
      streak: newStreak,
      lastFeedDate: currentDate,
      feedDates: feedDates.slice(-30) // Keep last 30 days for performance
    };

    saveStreakData(newStreakData);
    return newStreak;
  };

  // Initialize streak and previous coins spent on component mount
  useEffect(() => {
    const streakData = getStreakData();
    if (streakData.lastFeedDate) {
      const currentDate = getCurrentUSDate();
      const lastDate = new Date(streakData.lastFeedDate);
      const today = new Date(currentDate);
      const daysDifference = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // If more than 1 day has passed since last feeding, reset streak
      if (daysDifference > 1) {
        const resetStreakData = {
          streak: 0,
          lastFeedDate: streakData.lastFeedDate,
          feedDates: streakData.feedDates || []
        };
        saveStreakData(resetStreakData);
      }
    }
    
    // Initialize previous coins spent for current stage
    setPreviousCoinsSpentForStage(getCoinsSpentForCurrentStage(currentStreak));
  }, []);

  // Update action states when den ownership or sleep state changes
  useEffect(() => {
    setActionStates(getActionStates());
  }, [currentPet, ownedDens, getCurrentSleepCoinsSpent()]);

  
  // TTS message ID for tracking speaking state
  const petMessageId = 'pet-message';
  const isSpeaking = useTTSSpeaking(petMessageId);
  
  // Pet action states - dynamically updated based on den ownership and sleep state
  const getActionStates = () => {
    const baseActions = [
      { id: 'water', icon: '🍪', status: 'sad' as ActionStatus, label: 'Food' },
    ];
    
    // Add sleep button if den is owned and sleep coins spent < 50
    if (isDenOwned(currentPet)) {
      const sleepCoinsSpent = getCurrentSleepCoinsSpent();
      if (sleepCoinsSpent < 50) {
        let sleepLabel = 'Sleep';
        if (sleepCoinsSpent >= 30) {
          sleepLabel = 'Sleep)';
        } else if (sleepCoinsSpent >= 10) {
          sleepLabel = 'Sleep';
        } else if (sleepCoinsSpent > 0) {
          sleepLabel = 'Sleep';
        }
        baseActions.push({ id: 'sleep', icon: '😴', status: 'neutral' as ActionStatus, label: sleepLabel });
      }
    }
    
    // Always add more button at the end
    baseActions.push({ id: 'more', icon: '🐾', status: 'neutral' as ActionStatus, label: 'More' });
    
    return baseActions;
  };

  const [actionStates, setActionStates] = useState<ActionButton[]>(getActionStates());

  const handleActionClick = (actionId: string) => {
    // Handle sleep action
    if (actionId === 'sleep') {
      if (!isDenOwned(currentPet)) {
        alert("You need to buy a den first before your pet can sleep!");
        return;
      }
      
      // Prevent sleep action if image is still loading
      if (isImageLoading) {
        return;
      }
      
      const currentSleepCoins = getCurrentSleepCoinsSpent();
      const nextCost = 10; // Each sleep upgrade always costs 10 coins
      
      // Check if already at max sleep level (50 coins)
      if (currentSleepCoins >= 50) {
        alert("Your pet is already at maximum sleep comfort!");
        return;
      }
      
      // Check if player has enough coins
      if (!hasEnoughCoins(nextCost)) {
        alert(`Not enough coins! You need ${nextCost} coins to upgrade sleep comfort.`);
        return;
      }
      
      // Set loading state and start timeout for sleep action
      setIsImageLoading(true);
      setCurrentAction('sleep');
      
      // Clear any existing timeout
      if (imageLoadTimeout) {
        clearTimeout(imageLoadTimeout);
      }
      
      // Set 2-second timeout fallback
      const timeout = setTimeout(() => {
        setIsImageLoading(false);
        setCurrentAction(null);
        setImageLoadTimeout(null);
      }, 2000);
      setImageLoadTimeout(timeout);
      
      // Spend coins and add to sleep coins spent
      spendCoins(nextCost);
      addSleepCoinsSpent(currentPet, nextCost);
      
      // Play a gentle sleep sound
      playFeedingSound(); // Reuse feeding sound for now
      
      // Trigger heart animation for sleep progress
      setShowHeartAnimation(true);
      setTimeout(() => setShowHeartAnimation(false), 600);
      
      // Stop any current audio when pet gets sleepier
      ttsService.stop();
      
      return;
    }

    // Don't deduct coins for "More" action - always open pet shop
    if (actionId === 'more') {
      // Stop any current audio when opening pet shop
      ttsService.stop();
      setShowPetShop(true);
      return;
    }

    // Prevent feeding if image is still loading
    if (isImageLoading) {
      return;
    }

    // Check if player has enough coins for feeding actions
    if (!hasEnoughCoins(10)) {
      alert("Not enough coins! You need 10 coins to perform this action.");
      return;
    }

    // Set loading state and start timeout
    setIsImageLoading(true);
    setCurrentAction('food');
    
    // Clear any existing timeout
    if (imageLoadTimeout) {
      clearTimeout(imageLoadTimeout);
    }
    
    // Set 2-second timeout fallback (most images load much faster)
    const timeout = setTimeout(() => {
      setIsImageLoading(false);
      setCurrentAction(null);
      setImageLoadTimeout(null);
    }, 2000);
    setImageLoadTimeout(timeout);

    // Play feeding sound
    playFeedingSound();

    // Deduct coins and increase care level
    spendCoins(10);
    setCareLevel(Math.min(careLevel + 1, 6), currentStreak); // Max 6 actions, pass current streak
    
    // Track coins spent on current pet
    addPetCoinsSpent(currentPet, 10);
    
    // Update streak based on calendar days
    const newStreak = updateStreak();

    // Trigger heart animation
    setShowHeartAnimation(true);
    setTimeout(() => setShowHeartAnimation(false), 600);

    // Update action status to happy
    setActionStates(prev => prev.map(action => 
      action.id === actionId 
        ? { ...action, status: 'happy' }
        : action
    ));
  };


  const getStatusEmoji = (status: ActionStatus) => {
    switch (status) {
      // case 'happy': return '😊';
      // case 'sad': return '😢';
      case 'neutral': return '';
      default: return '';
    }
  };

  // Sound effect functions
  const playFeedingSound = () => {
    try {
      // Create a pleasant "nom nom" eating sound using Web Audio API
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Create a short, pleasant eating sound
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Pleasant "crunch" sound frequencies
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.1);
      oscillator.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.2);
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      oscillator.type = 'triangle';
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (error) {
      console.log('Audio not supported');
    }
  };

  const playEvolutionSound = () => {
    try {
      // Create a magical "sparkle" evolution sound
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Create multiple tones for a magical effect
      const frequencies = [523, 659, 784, 1047]; // C, E, G, C (major chord)
      
      frequencies.forEach((freq, index) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(freq, audioContext.currentTime + index * 0.1);
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0, audioContext.currentTime + index * 0.1);
        gainNode.gain.linearRampToValueAtTime(0.2, audioContext.currentTime + index * 0.1 + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + index * 0.1 + 0.8);
        
        oscillator.start(audioContext.currentTime + index * 0.1);
        oscillator.stop(audioContext.currentTime + index * 0.1 + 0.8);
      });
    } catch (error) {
      console.log('Audio not supported');
    }
  };

  // Get Bobo images based on coins spent
  const getBoboImage = (coinsSpent: number) => {
    if (coinsSpent >= 50) {
      return "TBD - Bobo (50+ coins)";
    } else if (coinsSpent >= 30) {
      return "TBD - Bobo (30+ coins)";
    } else if (coinsSpent >= 10) {
      return "TBD - Bobo (10+ coins)";
    } else {
      return "TBD - Bobo (0+ coins)";
    }
  };

  // Get Feather images based on coins spent
  const getFeatherImage = (coinsSpent: number) => {
    if (coinsSpent >= 50) {
      return "TBD - Feather (50+ coins)";
    } else if (coinsSpent >= 30) {
      return "TBD - Feather (30+ coins)";
    } else if (coinsSpent >= 10) {
      return "TBD - Feather (10+ coins)";
    } else {
      return "TBD - Feather (0+ coins)";
    }
  };

  // Get Jennie images based on coins spent
  const getJennieImage = (coinsSpent: number) => {
    if (coinsSpent >= 50) {
      return "TBD - Jennie (50+ coins)";
    } else if (coinsSpent >= 30) {
      return "TBD - Jennie (30+ coins)";
    } else if (coinsSpent >= 10) {
      return "TBD - Jennie (10+ coins)";
    } else {
      return "TBD - Jennie (0+ coins)";
    }
  };

  // Get sleepy pet images based on sleep coins spent
  const getSleepyPetImage = (sleepCoinsSpent: number) => {
    if (sleepCoinsSpent >= 50) {
      // 50 coins spent - TBD image (placeholder for now)
      return "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250911_160705_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
    } else if (sleepCoinsSpent >= 30) {
      // 30 coins spent - TBD image (placeholder for now)
      return "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250911_155438_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
    } else if (sleepCoinsSpent >= 10) {
      // 10 coins spent - TBD image (placeholder for now)
      return "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250911_155621_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
    } else {
      // 0 coins spent - use the provided image
      return "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250911_153821_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
    }
  };

  const getPetImage = () => {
    // If den is owned, show sleep images based on sleep coins spent
    if (isDenOwned(currentPet) && currentPet === 'cat') {
      const sleepCoinsSpent = getCurrentSleepCoinsSpent();
      return getSleepyPetImage(sleepCoinsSpent);
    }
    
    // Check if Bobo is owned and being displayed
    if (currentPet === 'bobo' && isPetOwned('bobo')) {
      // For Bobo, use pet-specific coin tracking
      const boboCoinsSpent = getPetCoinsSpent('bobo');
      return getBoboImage(boboCoinsSpent);
    }
    
    // Check if Feather is owned and being displayed
    if (currentPet === 'feather' && isPetOwned('feather')) {
      // For Feather, use pet-specific coin tracking
      const featherCoinsSpent = getPetCoinsSpent('feather');
      return getFeatherImage(featherCoinsSpent);
    }
    
    // Check if Jennie is owned and being displayed
    if (currentPet === 'jennie' && isPetOwned('jennie')) {
      // For Jennie, use pet-specific coin tracking
      const jennieCoinsSpent = getPetCoinsSpent('jennie');
      return getJennieImage(jennieCoinsSpent);
    }
    
    // Calculate coins spent on feeding for current evolution stage (for dog)
    const coinsSpentOnFeeding = getCoinsSpentForCurrentStage(currentStreak);
    
    // Check streak level for different cat evolution tiers
    let currentImage;
    
    if (currentStreak >= 3) {
      // Fully evolved cat versions for users with 3+ day streak
      if (coinsSpentOnFeeding >= 50) {
        currentImage = "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250909_234447_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
      } else if (coinsSpentOnFeeding >= 30) {
        currentImage = "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250909_234441_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
      } else if (coinsSpentOnFeeding >= 10) {
        currentImage = "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250909_234455_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
      } else {
        currentImage = "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250909_234430_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
      }
    } else if (currentStreak >= 2) {
      // Grown cat versions for users with 2+ day streak
      if (coinsSpentOnFeeding >= 50) {
        currentImage = "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250909_234447_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
      } else if (coinsSpentOnFeeding >= 30) {
        currentImage = "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250909_234441_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
      } else if (coinsSpentOnFeeding >= 10) {
        currentImage = "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250909_234455_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
      } else {
        currentImage = "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250909_234430_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
      }
    } else {
      // Original small kitten images for users with <2 day streak
      if (coinsSpentOnFeeding >= 50) {
        currentImage = "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250910_000550_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
      } else if (coinsSpentOnFeeding >= 30) {
        currentImage = "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250909_234447_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
      } else if (coinsSpentOnFeeding >= 10) {
        currentImage = "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250909_234441_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
      } else {
        currentImage = "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250909_234430_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
      }
    }
    
    // Check if pet evolved and play sound based on coins spent in current stage
    if (previousCoinsSpentForStage !== coinsSpentOnFeeding) {
      // Play sound when crossing evolution thresholds within current stage
      if ((previousCoinsSpentForStage < 30 && coinsSpentOnFeeding >= 30) || 
          (previousCoinsSpentForStage < 50 && coinsSpentOnFeeding >= 50)) {
        setTimeout(() => playEvolutionSound(), 400); // Delay to sync with animation
      }
      setPreviousCoinsSpentForStage(coinsSpentOnFeeding);
    }
    
    return currentImage;
  };

  const handlePetPurchase = (petType: string, cost: number) => {
    if (!hasEnoughCoins(cost)) {
      alert(`Not enough coins! You need ${cost} coins to buy this pet.`);
      return;
    }

    if (isPetOwned(petType)) {
      alert("You already own this pet!");
      return;
    }

    // Deduct coins and add pet to owned pets
    spendCoins(cost);
    addOwnedPet(petType);
    
    // Switch to the newly purchased pet
    setCurrentPet(petType);
    
    // Play purchase sound (reuse evolution sound for now)
    playEvolutionSound();
    
    // Special message for Bobo and Feather about arrival time
    if (petType === 'bobo' || petType === 'feather') {
      const petName = petType === 'bobo' ? 'Bobo' : 'Feather';
      alert(`Congratulations! You bought ${petName}! Your new pet will arrive in your pet park within 24 hours!`);
    } else {
      alert(`Congratulations! You bought a ${petType}!`);
    }
  };

  // Pet store data structure - dynamically updated with current ownership status
  const getPetStoreData = () => {
    // Use storeRefreshTrigger and ownedPets to force re-evaluation when pets are purchased
    const currentOwnedPets = ownedPets; // This ensures we use the latest owned pets from the hook
    storeRefreshTrigger; // This ensures the function re-runs when trigger changes
    
    // Ensure we use the latest pet ownership data
    
    return {
    cat: {
      id: 'cat',
      emoji: '🐱',
      name: 'Azrael',
      owned: true, // Cat is always owned by default
      cost: 0,
      den: {
        id: 'cozy_cathouse',
        name: 'Cozy Cat House Den',
        emoji: '🏠',
        cost: 50,
        description: 'A warm, comfortable space for Azrael to rest and play - will arrive in 24 hours!'
      },
      accessories: []
    },
    jennie: {
      id: 'jennie',
      emoji: '👩‍🎤',
      name: 'Jennie',
      owned: isPetOwned('jennie'),
      cost: 50,
      den: {
        id: 'music_studio',
        name: 'Music Studio Den',
        emoji: '🎵',
        cost: 50,
        description: 'A stylish studio for creating amazing music - will arrive in 24 hours!'
      },
      accessories: []
    },
    more_coming: {
      id: 'more_coming',
      emoji: '✨',
      name: 'More Coming Soon!',
      owned: false,
      cost: 0,
      isPlaceholder: true,
      den: {
        id: 'placeholder_den',
        name: 'More Dens Coming Soon!',
        emoji: '🔮',
        cost: 0,
        description: 'Exciting new dens will be added in future updates!'
      },
      accessories: []
    }
    };
  };

  // ElevenLabs Text-to-Speech function using the proper TTS service
  const speakText = async (text: string) => {
    if (!audioEnabled || text === lastSpokenMessage) return;
    
    try {
      // Stop any currently playing audio
      ttsService.stop();
      
      setLastSpokenMessage(text);
      
      // Use the TTS service with a child-friendly voice and appropriate settings
      await ttsService.speak(text, {
        stability: 0.7,
        similarity_boost: 0.8,
        speed: 0.9, // Slightly slower for better comprehension
        messageId: petMessageId,
        voice: 'cgSgspJ2msm6clMCkdW9' // Jessica voice - warm and friendly for children
      });
    } catch (error) {
      console.error('TTS error:', error);
    }
  };

  const getPetThought = () => {
    // Helper function to randomly select from an array of thoughts
    const getRandomThought = (thoughts: string[]) => {
      return thoughts[Math.floor(Math.random() * thoughts.length)];
    };
    
    // If pet has a den, show sleep-related thoughts based on sleep coins spent
    if (isDenOwned(currentPet)) {
      const sleepCoinsSpent = getCurrentSleepCoinsSpent();
      
      if (sleepCoinsSpent >= 50) {
        const maxSleepThoughts = [
          "💤💤💤 Zzz... Piper, I'm completely asleep... dreaming peacefully...",
          "😴 Piper... I'm deep in dreamland... having the most wonderful dreams...",
          "💤 Piper, I'm fully rested... sleeping like a baby...",
          "Zzz... 🌙 Piper, I'm in the deepest, most comfortable sleep..."
        ];
        return getRandomThought(maxSleepThoughts);
      } else if (sleepCoinsSpent >= 30) {
        const deepSleepThoughts = [
          "😴 Piper, I'm getting very drowsy... almost fully asleep...",
          "💤 Piper, I'm so sleepy... my eyelids are getting heavy...",
          "Zzz... 😴 Piper, I'm drifting deeper into sleep...",
          "💤 Piper, I'm almost there... feeling so relaxed and sleepy..."
        ];
        return getRandomThought(deepSleepThoughts);
      } else if (sleepCoinsSpent >= 10) {
        const sleepyThoughts = [
          "Zzz... 😴 Piper, I'm getting so sleepy... this feels nice...",
          "💤 Yawn... Piper, I'm drifting off to dreamland...",
          "😴 Piper, it's so cozy and warm... perfect for a nap...",
          "Zzz... 💭 Piper, I'm dreaming of cookies and adventures..."
        ];
        return getRandomThought(sleepyThoughts);
      } else {
        // 0 coins spent - show initial den/sleep thoughts
        const initialDenThoughts = [
          "😴 Wow! Piper, I have my own den now! This is so cozy and comfortable...",
          "💤 Piper, having my own special place makes me feel so safe and sleepy...",
          "😴 Piper, this den is perfect for resting! I could take a nice nap here...",
          "💤 Piper, my very own den! Now I can sleep peacefully whenever I want...",
          "😴 Piper, I love having a cozy place to call my own! Time for some rest...",
          "💤 Piper, this den is so comfortable... I'm already feeling drowsy...",
          "😴 Piper, finally, a safe and warm place to sleep! This feels amazing!",
          "💤 Piper, my own little sanctuary! Perfect for sweet dreams and rest..."
        ];
        return getRandomThought(initialDenThoughts);
      }
    }
    
    // Different thoughts for different pets
    if (currentPet === 'bobo' && isPetOwned('bobo')) {
      const boboCoinsSpent = getPetCoinsSpent('bobo');
      
      if (boboCoinsSpent === 0) {
        const hungryThoughts = [
          "Oook ook! 🐵 I'm Bobo! My banana belly is empty... can you feed me some cookies?",
          "Hey there, Piper! 🍌 Bobo here! I'm swinging from hunger... got any treats?",
          "Oook! It's me, your monkey friend Bobo! 🐵 My tummy is rumbling for some cookies!",
          "Hi Piper! Bobo needs some yummy cookies! 🍪 My monkey appetite is huge!",
          "Oook ook! 🐵 Bobo is starving! Can you help your monkey friend with some treats?",
          "Piper! 🍌 Your monkey Bobo is so hungry... cookies would make me do happy flips!"
        ];
        return getRandomThought(hungryThoughts);
      } else if (boboCoinsSpent < 30) {
        const satisfiedThoughts = [
          "Mmm banana-licious! 🍌 More cookies will make this monkey swing with joy!",
          "Oook ook! Those cookies were amazing! 🐵 But Bobo could eat more!",
          "Yum yum! 🍪 These treats are perfect for a growing monkey like me!",
          "Oook! Those cookies hit the spot! 🐵 But my monkey appetite is still growing!",
          "Thank you, Piper! 🥰 Those cookies were perfect, but Bobo is still a little peckish!",
          "Delicious! 🍪 My tail is wagging so fast! More cookies would make me flip with happiness!"
        ];
        return getRandomThought(satisfiedThoughts);
      } else if (boboCoinsSpent < 50) {
        const growingThoughts = [
          "Oook ook! I'm growing stronger! 🐵 Keep feeding me - I'm getting bigger and more agile!",
          "Look at me swing! 💪 I can feel myself getting stronger with each cookie!",
          "Amazing! I'm growing so fast! 🌱 More cookies will help me become the ultimate monkey!",
          "Piper, I feel so energetic! ⚡ These cookies are making me bigger and more acrobatic!",
          "Oook ook! I'm transforming! 🦋 Keep the cookies coming - I'm almost ready for the next stage!",
          "Incredible! My monkey body is changing! 🐵 More cookies will help me reach my full potential!"
        ];
        return getRandomThought(growingThoughts);
      } else {
        const happyThoughts = [
          "Oook ook! 🥳 I feel amazing, Piper! Now... could you get me some monkey friends to play with!",
          "Oook ook! I'm so strong now! 💪 Maybe it's time to find some playmates to swing with?",
          "I feel fantastic! 🌟 All those cookies worked! Now I'm ready for some monkey business with friends!",
          "Amazing! I'm at my best! ✨ Piper, can you help me find some buddies to climb trees with?",
          "Hooray! I'm fully grown! 🎉 Can you help me find some monkey friends to play with?",
          "Perfect! I feel incredible! 🚀 Maybe it's time to find some playmates for jungle adventures?"
        ];
        return getRandomThought(happyThoughts);
      }
    }

    // Feather-specific thoughts based on coins spent
    if (currentPet === 'feather' && isPetOwned('feather')) {
      const featherCoinsSpent = getPetCoinsSpent('feather');
      
      if (featherCoinsSpent === 0) {
        const hungryThoughts = [
          "Chirp chirp! 🦜 I'm Feather! My little bird belly is empty... can you feed me some seeds?",
          "Tweet tweet! 🌟 Feather here! I'm fluttering from hunger... got any treats?",
          "Chirp! It's me, your feathered friend Feather! 🦜 My tummy is chirping for some seeds!",
          "Hi Piper! Feather needs some yummy seeds! 🌱 My bird appetite is huge!",
          "Tweet tweet! 🦜 Feather is starving! Can you help your bird friend with some treats?",
          "Piper! 🌟 Your bird Feather is so hungry... seeds would make me sing beautiful songs!"
        ];
        return getRandomThought(hungryThoughts);
      } else if (featherCoinsSpent < 30) {
        const satisfiedThoughts = [
          "Tweet tweet! 🌱 More seeds will make this bird sing with joy!",
          "Chirp chirp! Those seeds were amazing! 🦜 But Feather could eat more!",
          "Yum yum! 🌾 These treats are perfect for a growing bird like me!",
          "Tweet! Those seeds hit the spot! 🦜 But my bird appetite is still growing!",
          "Thank you, Piper! 🥰 Those seeds were perfect, but Feather is still a little peckish!",
          "Delicious! 🌱 My wings are flapping so fast! More seeds would make me soar with happiness!"
        ];
        return getRandomThought(satisfiedThoughts);
      } else if (featherCoinsSpent < 50) {
        const growingThoughts = [
          "Tweet tweet! I'm growing stronger! 🦜 Keep feeding me - I'm getting bigger and more colorful!",
          "Look at me fly! 💪 I can feel myself getting stronger with each seed!",
          "Amazing! I'm growing so fast! 🌱 More seeds will help me become the ultimate bird!",
          "Piper, I feel so energetic! ⚡ These seeds are making me bigger and more graceful!",
          "Tweet tweet! I'm transforming! 🦋 Keep the seeds coming - I'm almost ready for the next stage!",
          "Incredible! My feathers are changing! 🦜 More seeds will help me reach my full potential!"
        ];
        return getRandomThought(growingThoughts);
      } else {
        const happyThoughts = [
          "Tweet tweet! 🥳 I feel amazing, Piper! Now... could you get me some bird friends to fly with!",
          "Tweet tweet! I'm so strong now! 💪 Maybe it's time to find some playmates to soar with?",
          "I feel fantastic! 🌟 All those seeds worked! Now I'm ready for some aerial adventures with friends!",
          "Amazing! I'm at my best! ✨ Piper, can you help me find some buddies to fly through clouds with?",
          "Hooray! I'm fully grown! 🎉 Can you help me find some bird friends to play with?",
          "Perfect! I feel incredible! 🚀 Maybe it's time to find some playmates for sky adventures?"
        ];
        return getRandomThought(happyThoughts);
      }
    }

    // Jennie-specific thoughts based on coins spent
    if (currentPet === 'jennie' && isPetOwned('jennie')) {
      const jennieCoinsSpent = getPetCoinsSpent('jennie');
      
      if (jennieCoinsSpent === 0) {
        const hungryThoughts = [
          "Hey Piper! 👩‍🎤 I'm Jennie! I need some energy to create amazing music... can you help me out?",
          "Annyeong! It's me, Jennie! 🎵 I'm feeling a bit low on energy... could you give me some treats?",
          "Hi there, Piper... Jennie here 👩‍🎤 My creative energy is running low... feed me, please?",
          "Hey friend... I'm Jennie and I need fuel for my performances... 🍪 Do you have any treats?",
          "Piper... It's your girl Jennie! 👩‍🎤 I haven't eaten yet and my energy is so low... can you help?",
          "Piper... 🎵 My stomach is empty and I can't focus on music... treats would really help!"
        ];
        return getRandomThought(hungryThoughts);
      } else if (jennieCoinsSpent < 30) {
        const satisfiedThoughts = [
          "Mmm... delicious! 🍪 More treats will give me energy to sing even better!",
          "That was amazing! 😋 But I could definitely eat more treats, Piper!",
          "Yum yum! 🍪 These treats are perfect! Can I have another one for my next performance?",
          "So good! Those treats hit the spot! 👩‍🎤 But I'm still building up my energy!",
          "Thank you, Piper! 🥰 Those treats were perfect, but I'm still a little hungry!",
          "Delicious! 🍪 I'm feeling more energetic already! More treats would make me shine even brighter!"
        ];
        return getRandomThought(satisfiedThoughts);
      } else if (jennieCoinsSpent < 50) {
        const growingThoughts = [
          "Wow! I'm getting stronger! 👩‍🎤 Keep feeding me - I'm ready for bigger performances!",
          "Look at me glow! 💪 I can feel myself getting more confident with each treat!",
          "Amazing! I'm growing so much! 🌱 More treats will help me become the ultimate performer!",
          "Piper, I feel so energetic! ⚡ These treats are making me more talented and charismatic!",
          "Yes! I'm transforming! 🦋 Keep the treats coming - I'm almost ready for the main stage!",
          "Incredible! My performance skills are improving! 🎵 More treats will help me reach my full potential!"
        ];
        return getRandomThought(growingThoughts);
      } else {
        const happyThoughts = [
          "Perfect! 🥳 I feel amazing, Piper! Now... could you find me some backup dancers to perform with?",
          "Yes! I'm at my peak now! 💪 Maybe it's time to find some friends to start a group with?",
          "I feel fantastic! 🌟 All those treats worked! Now I'm ready for collaborations with other artists!",
          "Amazing! I'm at my best! ✨ Piper, can you help me find some talented friends to make music with?",
          "Hooray! I'm fully powered up! 🎉 Can you help me find some artist friends to create with?",
          "Perfect! I feel incredible! 🚀 Maybe it's time to find some creative partners for amazing performances?"
        ];
        return getRandomThought(happyThoughts);
      }
    }
    
    // Default cat thoughts
    const coinsSpentOnFeeding = getCoinsSpentForCurrentStage(currentStreak);
    
    // Pet thoughts based on coins spent on feeding
    if (coinsSpentOnFeeding === 0) {
      // No coins spent on feeding yet
      const hungryThoughts = [
        "Hi Piper... I'm Azrael 🐱 and my tummy's rumbling sadly. Could you please feed me some treats?",
        "Meow... It's me, Azrael! 🐱 I'm so hungry and feeling down... could you spare some treats for me?",
        "Hey there, Piper... Azrael here 🐱 My belly is making sad noises... feed me, please?",
        "`Hi Piper... I'm Azrael and I'm starving... 🍪 Do you have any treats to cheer me up?`",
        "Piper... It's your kitty Azrael! 🐱 I haven't eaten yet and I'm feeling so low... can you help me out?",
        "Piper... 🐱 My tummy feels so empty and sad... treats would really lift my spirits!"
      ];
      return getRandomThought(hungryThoughts);
    } else if (coinsSpentOnFeeding < 30) {
      // 10-20 coins spent on feeding (1-2 feedings)
      const satisfiedThoughts = [
        "Purr… yummy! 🍪 More treats will make me purr even louder!",
        "That was delicious! 😋 But I could definitely eat more treats, Piper!",
        "Nom nom nom! 🍪 These treats are amazing! Can I have another one?",
        "Meow! Those treats hit the spot! 🐱 But my appetite is still growing!",
        "Thank you, Piper! 🥰 Those treats were perfect, but I'm still a little peckish!",
        "Yum yum! 🍪 My tail is swishing so fast! More treats would make me even happier!"
      ];
      return getRandomThought(satisfiedThoughts);
    } else if (coinsSpentOnFeeding < 50) {
      // 30-40 coins spent on feeding (3-4 feedings)
      const growingThoughts = [
        "Meow meow! I'm feeling stronger! 🐱 Keep feeding me - I love these treats!",
        "Look at me pounce! 💪 I can feel myself getting more energetic with each treat!",
        "Amazing! These treats are so good! 🌱 More treats will help me feel even better!",
        "Piper, I feel so energetic! ⚡ These treats are making me more playful and happy!",
        "Purr purr! I'm feeling fantastic! 🦋 Keep the treats coming - they're delicious!",
        "Incredible! I feel so full and content! 🐱 More treats will keep my tummy happy!"
      ];
      return getRandomThought(growingThoughts);
    } else {
      // 50+ coins spent on feeding (5+ feedings)
      const happyThoughts = [
        "Purr! 🥳 I feel amazing, Piper! Now… could you find me some cat friends to play with?",
        "Meow meow! I'm so full and happy now! 💪 Maybe it's time to find some playmates to chase mice with?",
        "I feel fantastic! 🌟 All those treats worked! Now I'm ready for some fun with friends!",
        "Amazing! I'm at my best! ✨ Piper, can you help me find some buddies to explore with?",
        "Hooray! I'm so content! 🎉 Can you help me find some cat friends to play with?",
        "Perfect! I feel incredible! 🚀 Maybe it's time to find some playmates for adventures?"
      ];
      return getRandomThought(happyThoughts);
    }
  };

  // Get coins spent for current pet
  const getCurrentPetCoinsSpent = () => {
    if (currentPet === 'cat') {
      return getCoinsSpentForCurrentStage(currentStreak);
    } else {
      return getPetCoinsSpent(currentPet);
    }
  };

  // Get current pet coins spent value
  const currentPetCoinsSpent = getCurrentPetCoinsSpent();

  // Image loading handlers
  const handleImageLoad = () => {
    // Clear timeout and reset loading state when image loads successfully
    if (imageLoadTimeout) {
      clearTimeout(imageLoadTimeout);
      setImageLoadTimeout(null);
    }
    setIsImageLoading(false);
    setCurrentAction(null);
  };

  const handleImageError = () => {
    // Clear timeout and reset loading state on error
    if (imageLoadTimeout) {
      clearTimeout(imageLoadTimeout);
      setImageLoadTimeout(null);
    }
    setIsImageLoading(false);
    setCurrentAction(null);
    console.warn('Pet image failed to load');
  };

  // Preload next evolution images for faster transitions
  const preloadImage = (url: string) => {
    if (preloadedImages.has(url)) return;
    
    const img = new Image();
    img.onload = () => {
      setPreloadedImages(prev => new Set([...prev, url]));
    };
    img.onerror = () => {
      console.warn('Failed to preload image:', url);
    };
    img.src = url;
  };

  // Get next evolution image URL for preloading
  const getNextEvolutionImage = () => {
    const coinsSpentOnFeeding = getCoinsSpentForCurrentStage(currentStreak);
    
    if (currentPet === 'cat') {
      if (currentStreak >= 3) {
        if (coinsSpentOnFeeding >= 30 && coinsSpentOnFeeding < 50) {
          return "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250909_234447_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
        } else if (coinsSpentOnFeeding >= 10 && coinsSpentOnFeeding < 30) {
          return "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250909_234441_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
        } else if (coinsSpentOnFeeding < 10) {
          return "https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250909_234455_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN";
        }
      }
    }
    return null;
  };

  // Calculate heart fill percentage based on coins and sleep (if sleep is available)
  const getHeartFillPercentage = () => {
    const hasDen = isDenOwned(currentPet);
    
    if (hasDen) {
      // When den is owned, heart fill is primarily based on sleep progress
      const sleepCoinsSpent = getCurrentSleepCoinsSpent();
      const sleepProgress = Math.min(sleepCoinsSpent / 50, 1); // Max 50 sleep coins = 100%
      
      // Sleep fills the heart completely when at max (50 coins)
      if (sleepCoinsSpent >= 50) {
        return 100; // Fully filled when fully asleep
      }
      
      // Progressive fill based on sleep coins: 0, 10, 20, 30, 40, 50
      // Each 10 coins = 20% fill (50 coins = 100%)
      return (sleepCoinsSpent / 50) * 100;
    } else {
      // When sleep is not available, heart fill is based only on food coins
      const coinProgress = Math.min(currentPetCoinsSpent / 50, 1);
      return Math.min(coinProgress * 100, 100);
    }
  };

  // Memoize the pet thought so it only changes when the actual state changes
  const currentPetThought = useMemo(() => {
    return getPetThought();
  }, [currentPet, getCoinsSpentForCurrentStage(currentStreak), getPetCoinsSpent(currentPet), getCurrentSleepCoinsSpent(), ownedDens]);

  // Handle audio playback when message changes
  useEffect(() => {
    // Stop any currently playing audio when pet state changes
    ttsService.stop();
    
    // Only speak when:
    // 1. Not in pet shop
    // 2. Audio is enabled
    // 3. Message has changed
    if (!showPetShop && audioEnabled && currentPetThought !== lastSpokenMessage) {
      const timer = setTimeout(() => {
        speakText(currentPetThought);
      }, 500); // Small delay for smooth UX
      
      return () => clearTimeout(timer);
    }
  }, [currentPetThought, showPetShop, audioEnabled, lastSpokenMessage]);

  // Handle when pet shop closes - ensure voice plays new thoughts immediately
  useEffect(() => {
    if (!showPetShop && audioEnabled) {
      // Reset last spoken message when pet shop closes to ensure new thoughts are spoken
      setLastSpokenMessage('');
      
      // Small delay to ensure the thought has updated after den purchase
      const timer = setTimeout(() => {
        if (currentPetThought) {
          speakText(currentPetThought);
        }
      }, 300);
      
      return () => clearTimeout(timer);
    }
  }, [showPetShop]); // Only trigger when showPetShop changes

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (imageLoadTimeout) {
        clearTimeout(imageLoadTimeout);
      }
    };
  }, [imageLoadTimeout]);

  // Preload next evolution image when user is close to evolution
  useEffect(() => {
    const nextImageUrl = getNextEvolutionImage();
    if (nextImageUrl) {
      preloadImage(nextImageUrl);
    }
  }, [currentPetCoinsSpent, currentStreak, currentPet]);

  return (
    <div className="min-h-screen flex flex-col" style={{
      backgroundImage: `url('https://tutor.mathkraft.org/_next/image?url=%2Fapi%2Fproxy%3Furl%3Dhttps%253A%252F%252Fdubeus2fv4wzz.cloudfront.net%252Fimages%252F20250903_181706_image.png&w=3840&q=75&dpl=dpl_2uGXzhZZsLneniBZtsxr7PEabQXN')`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      fontFamily: 'Quicksand, system-ui, sans-serif'
    }}>
      {/* Glass overlay for better contrast */}
      <div className="absolute inset-0 bg-black/10 backdrop-blur-[1px]"></div>

      {/* Top UI - Coins and Streak */}
      <div className="absolute top-5 left-1/2 transform -translate-x-1/2 z-20 flex gap-4">
        {/* Coins */}
        <div className="bg-white/20 backdrop-blur-md rounded-xl px-4 py-3 border border-white/30 shadow-lg">
          <div className="flex items-center gap-2 text-white font-bold text-lg drop-shadow-md">
            <span className="text-xl">🪙</span>
            <span>{coins}</span>
          </div>
        </div>
        
        {/* Streak */}
        <div className="bg-white/20 backdrop-blur-md rounded-xl px-4 py-3 border border-white/30 shadow-lg">
          <div className="flex items-center gap-2 text-white font-bold text-lg drop-shadow-md">
            <span className="text-xl">🔥</span>
            <span>{currentStreak}</span>
          </div>
        </div>
      </div>

      {/* Testing Buttons - Development Only */}
      <div className="absolute bottom-5 left-5 z-20 flex flex-col gap-2">
        <button
          onClick={() => setCoins(100)}
          className="bg-transparent hover:bg-white/5 px-2 py-1 rounded text-transparent hover:text-white/20 text-xs transition-all duration-300 opacity-5 hover:opacity-30"
          title="Testing: Refill coins to 100"
        >
          🔄
        </button>
      </div>

      {/* Testing Button - Increase Streak (Development Only) */}
      <div className="absolute bottom-5 right-5 z-20">
        <button
          onClick={() => {
            const newStreak = currentStreak + 1;
            const streakData = getStreakData();
            const newStreakData = {
              ...streakData,
              streak: newStreak,
              lastFeedDate: getCurrentUSDate()
            };
            saveStreakData(newStreakData);
          }}
          className="bg-transparent hover:bg-white/5 px-2 py-1 rounded text-transparent hover:text-white/20 text-xs transition-all duration-300 opacity-5 hover:opacity-30"
          title="Testing: Increase streak by 1"
        >
          🔥
        </button>
      </div>

      {/* Top UI - Heart only */}
      <div className="absolute top-5 right-10 z-20">
        {/* Heart that fills with blood */}
        <div className="w-20 h-20 rounded-full flex items-center justify-center relative bg-white/20 backdrop-blur-sm border-2 border-white/30 shadow-lg">
          <div style={{
            position: 'relative',
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {/* Heart outline */}
            <div style={{
              position: 'absolute',
              fontSize: 84,
              color: '#E5E7EB'
            }}>
              🤍
            </div>
            {/* Filled heart (blood) */}
            <div style={{
              position: 'absolute',
              fontSize: 84,
              color: '#DC2626',
              clipPath: `inset(${Math.max(0, 100 - getHeartFillPercentage())}% 0 0 0)`,
              transition: 'clip-path 300ms ease-out'
            }}>
              ❤️
            </div>
          </div>
        </div>

        {/* Animated hearts moving from pet to main heart */}
        {showHeartAnimation && (
          <>
            <div style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              fontSize: 20,
              color: '#DC2626',
              animation: 'heartFlyFromPet1 1200ms ease-out forwards',
              pointerEvents: 'none',
              zIndex: 30
            }}>
              ❤️
            </div>
            <div style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              fontSize: 16,
              color: '#DC2626',
              animation: 'heartFlyFromPet2 1200ms ease-out forwards',
              animationDelay: '150ms',
              pointerEvents: 'none',
              zIndex: 30
            }}>
              ❤️
            </div>
            <div style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              fontSize: 18,
              color: '#DC2626',
              animation: 'heartFlyFromPet3 1200ms ease-out forwards',
              animationDelay: '300ms',
              pointerEvents: 'none',
              zIndex: 30
            }}>
              ❤️
            </div>
          </>
        )}
      </div>

      {/* Main pet area - moved down slightly */}
      <div className="flex-1 flex flex-col items-center justify-center relative pb-20 px-4 z-10 mt-16">
        {/* Pet Thought Bubble - Only show when pet shop is closed */}
        {!showPetShop && (
          <div className={`relative rounded-3xl p-5 mb-8 border-3 shadow-xl max-w-md w-full mx-4 backdrop-blur-sm ${
            isDenOwned(currentPet) && getCurrentSleepCoinsSpent() > 0 
              ? 'bg-gradient-to-br from-purple-50 to-indigo-100 border-purple-400 bg-purple-50/90'
              : 'bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-400 bg-white/90'
          }`}>
            {/* Speech bubble tail */}
            <div className={`absolute -bottom-3 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[12px] border-r-[12px] border-t-[12px] border-l-transparent border-r-transparent ${
              isDenOwned(currentPet) && getCurrentSleepCoinsSpent() > 0 ? 'border-t-purple-400' : 'border-t-blue-400'
            }`}></div>
            
            {/* Thought bubble dots */}
            <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 flex gap-1">
              <div className={`w-2 h-2 rounded-full animate-bounce ${
                isDenOwned(currentPet) && getCurrentSleepCoinsSpent() > 0 ? 'bg-purple-400' : 'bg-blue-400'
              }`} style={{animationDelay: '0s'}}></div>
              <div className={`w-1.5 h-1.5 rounded-full animate-bounce ${
                isDenOwned(currentPet) && getCurrentSleepCoinsSpent() > 0 ? 'bg-purple-400' : 'bg-blue-400'
              }`} style={{animationDelay: '0.3s'}}></div>
              <div className={`w-1 h-1 rounded-full animate-bounce ${
                isDenOwned(currentPet) && getCurrentSleepCoinsSpent() > 0 ? 'bg-purple-400' : 'bg-blue-400'
              }`} style={{animationDelay: '0.6s'}}></div>
            </div>

            <div className="text-sm text-slate-800 font-medium leading-relaxed text-center">
              {currentPetThought}
            </div>
          </div>
        )}

        {/* Pet (Custom Image) */}
        <div className="relative drop-shadow-2xl">
          <img 
            src={getPetImage()}
            alt="Pet"
            className={`object-contain rounded-2xl transition-all duration-700 ease-out hover:scale-105 ${
              isDenOwned(currentPet) && getCurrentSleepCoinsSpent() > 0 ? 'w-96 h-96 mt-8' : 'w-80 h-80'
            } ${isImageLoading ? 'opacity-70' : 'opacity-100'}`}
            style={{
              animation: careLevel * 10 >= 30 && careLevel * 10 < 50 ? 'petGrow 800ms ease-out' : 
                        careLevel * 10 >= 50 ? 'petEvolve 800ms ease-out' : 'none'
            }}
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
          
          {/* Loading overlay */}
          {isImageLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/20 backdrop-blur-sm rounded-2xl">
              <div className="flex flex-col items-center gap-3">
                {/* Animated action icon */}
                <div className="text-4xl animate-bounce">
                  {currentAction === 'sleep' ? '😴' : '🍪'}
                </div>
                {/* Spinner */}
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                <div className="text-white text-sm font-semibold drop-shadow-md animate-pulse">
                  {currentAction === 'sleep' ? 'Getting sleepy...' : 'Eating...'}
                </div>
                {/* Progress dots */}
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse" style={{animationDelay: '0s'}}></div>
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
                </div>
              </div>
            </div>
          )}
          
          {/* Sleep indicator */}
          {isDenOwned(currentPet) && getCurrentSleepCoinsSpent() > 0 && (
            <>
              {/* Floating Z's animation */}
              <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 text-2xl animate-bounce">
                💤
              </div>
            </>
          )}
        </div>
        
        {/* Food bowl */}
        <div className="absolute bottom-8 left-1/2 transform -translate-x-20 text-5xl drop-shadow-lg">
          🥣
        </div>
      </div>

      {/* Cat Evolution Display - Right Side */}
      <div className="absolute right-6 top-1/2 transform -translate-y-1/2 z-10 flex flex-col gap-4">
        {/* Small Kitten - Always available */}
        <div className="flex flex-col items-center">
          <div className="relative p-3 rounded-2xl border-2 transition-all duration-300 bg-gradient-to-br from-blue-100 to-cyan-100 border-blue-400 shadow-lg">
            <div className="text-5xl transition-all duration-300 grayscale-0">
              🐱
            </div>
            <div className="absolute -top-2 -right-2 bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
              ✓
            </div>
          </div>
          <div className="text-xs font-semibold text-center mt-2 text-white drop-shadow-md">
            1 Day 🔥
          </div>
        </div>

        {/* Medium Cat - Unlocks at 2 consecutive days */}
        <div className="flex flex-col items-center">
          <div className={`relative p-4 rounded-2xl border-2 transition-all duration-300 ${
            currentStreak >= 2 
              ? 'bg-gradient-to-br from-yellow-100 to-orange-100 border-yellow-400 shadow-lg' 
              : 'bg-gray-100 border-gray-300 opacity-60'
          }`}>
            <div className={`text-6xl transition-all duration-300 ${
              currentStreak >= 2 ? 'grayscale-0' : 'grayscale'
            }`}>
              😸
            </div>
            {currentStreak >= 2 && (
              <div className="absolute -top-2 -right-2 bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                ✓
              </div>
            )}
          </div>
          <div className="text-xs font-semibold text-center mt-2 text-white drop-shadow-md">
            {currentStreak >= 2 ? 'Medium Cat' : '2 Days 🔥'}
          </div>
        </div>

        {/* Large Cat - Unlocks at 3 consecutive days */}
        <div className="flex flex-col items-center">
          <div className={`relative p-4 rounded-2xl border-2 transition-all duration-300 ${
            currentStreak >= 3 
              ? 'bg-gradient-to-br from-purple-100 to-pink-100 border-purple-400 shadow-lg' 
              : 'bg-gray-100 border-gray-300 opacity-60'
          }`}>
            <div className={`text-7xl transition-all duration-300 ${
              currentStreak >= 3 ? 'grayscale-0' : 'grayscale'
            }`}>
              🦁
            </div>
            {currentStreak >= 3 && (
              <div className="absolute -top-2 -right-2 bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                ✓
              </div>
            )}
          </div>
          <div className="text-xs font-semibold text-center mt-2 text-white drop-shadow-md">
            {currentStreak >= 3 ? 'Large Cat' : '3 Days 🔥'}
          </div>
        </div>

      </div>

      {/* Bottom Action Buttons */}
      <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 z-30">
        <div className="flex gap-4 px-4 py-2 bg-white/20 backdrop-blur-md rounded-2xl border border-white/30 shadow-xl">
        {getActionStates().map((action) => (
          <button
            key={action.id}
            onClick={() => handleActionClick(action.id)}
            disabled={(action.id === 'water' || action.id === 'sleep') && isImageLoading}
            className={`flex flex-col items-center gap-1 p-3 bg-transparent border-none rounded-xl min-w-16 transition-all duration-150 ${
              (action.id === 'water' || action.id === 'sleep') && isImageLoading 
                ? 'opacity-50 cursor-not-allowed' 
                : 'cursor-pointer hover:bg-white/20 hover:-translate-y-1 active:scale-95 active:bg-white/30'
            }`}
          >
            {/* Status emoji */}
            {getStatusEmoji(action.status) && (
              <div className="absolute -top-2 -right-2 text-lg bg-white rounded-full w-8 h-8 flex items-center justify-center shadow-md">
                {getStatusEmoji(action.status)}
              </div>
            )}
            
            {/* Action icon */}
            <div className="text-4xl drop-shadow-lg">
              {action.icon}
            </div>
            
            {/* Action label - small text below */}
            <div className="text-xs font-semibold text-white drop-shadow-md">
              {action.label}
            </div>
            
                            {/* Coin cost for Food action */}
            {action.id === 'water' && (
              <div className="text-xs font-semibold text-yellow-300 drop-shadow-md">
                {isImageLoading ? 'Eating...' : '10 coins'}
              </div>
            )}
            
            {/* Cost indicator for Sleep action */}
            {action.id === 'sleep' && (
              <div className="text-xs font-semibold text-yellow-300 drop-shadow-md">
                {(() => {
                  const currentSleepCoins = getCurrentSleepCoinsSpent();
                  if (currentSleepCoins >= 50) return 'Max level';
                  return isImageLoading ? 'Sleeping...' : '10 coins';
                })()}
              </div>
            )}
          </button>
        ))}
        </div>
      </div>

      {/* Audio Toggle Button */}
      <button
        onClick={() => {
          setAudioEnabled(!audioEnabled);
          if (isSpeaking) {
            ttsService.stop();
          }
        }}
        className={`fixed bottom-6 right-6 w-14 h-14 rounded-full border-2 border-white/30 text-2xl flex items-center justify-center shadow-xl z-40 transition-all duration-200 hover:scale-110 active:scale-95 ${
          audioEnabled 
            ? 'bg-gradient-to-br from-emerald-500 to-green-600 text-white' 
            : 'bg-gradient-to-br from-red-500 to-red-600 text-white'
        }`}
      >
        {audioEnabled ? '🔊' : '🔇'}
      </button>

      {/* Pet Switcher - Only show if user owns multiple pets */}
      {ownedPets.length > 1 && (
        <div className="fixed top-24 left-6 z-20 flex flex-col gap-2">
          <div className="text-xs font-semibold text-white drop-shadow-md mb-1">
            Your Pets:
          </div>
          {ownedPets.map((petId) => {
            const petEmoji = petId === 'cat' ? '🐱' : petId === 'jennie' ? '👩‍🎤' : petId === 'dog' ? '🐶' : petId === 'bobo' ? '🐵' : petId === 'feather' ? '🦜' : '🐾';
            const isActive = currentPet === petId;
            
            return (
              <button
                key={petId}
                onClick={() => setCurrentPet(petId)}
                className={`w-12 h-12 rounded-xl border-2 text-2xl flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-110 ${
                  isActive 
                    ? 'bg-gradient-to-br from-blue-500 to-purple-600 border-white text-white' 
                    : 'bg-white/20 backdrop-blur-md border-white/30 text-white hover:bg-white/30'
                }`}
                title={`Switch to ${petId === 'cat' ? 'Azrael' : petId === 'jennie' ? 'Jennie' : petId === 'dog' ? 'April' : petId === 'bobo' ? 'Bobo' : petId === 'feather' ? 'Feather' : petId}`}
              >
                {petEmoji}
              </button>
            );
          })}
        </div>
      )}

      {/* Pet Shop Overlay */}
      {showPetShop && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-gradient-to-br from-white to-slate-50 rounded-3xl max-w-5xl w-11/12 max-h-[85vh] shadow-2xl relative border-2 border-gray-200 flex overflow-hidden">
            {/* Close button */}
            <button
              onClick={() => setShowPetShop(false)}
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-red-600 text-white border-none cursor-pointer text-lg flex items-center justify-center shadow-lg hover:scale-110 transition-transform z-10"
            >
              ×
            </button>

            {/* Left Column: Pet Selection */}
            <div className="w-1/4 bg-gradient-to-b from-blue-50 to-indigo-100 p-4 border-r-2 border-gray-200">
              <h3 className="text-2xl font-bold text-gray-800 mb-4 text-center">
                Pets
              </h3>
              <div className="space-y-2">
                {Object.values(getPetStoreData()).map((pet) => (
                  <button
                    key={pet.id}
                    onClick={() => setSelectedStorePet(pet.id)}
                    className={`w-full p-4 rounded-xl border-2 transition-all duration-200 flex items-center justify-center ${
                      selectedStorePet === pet.id
                        ? 'bg-gradient-to-r from-blue-500 to-purple-600 border-white text-white shadow-lg'
                        : 'bg-white/50 border-gray-300 text-gray-700 hover:bg-white/80 hover:border-blue-300'
                    }`}
                  >
                    <div className="text-4xl">{pet.emoji}</div>
                  </button>
                ))}
              </div>
              
              {/* Current coins display */}
              <div className="mt-4 p-3 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-xl text-white font-semibold text-center shadow-lg">
                Coins: {coins}
              </div>
            </div>

            {/* Right Column: Pet-Specific Store */}
            <div className="flex-1 p-6 overflow-y-auto">
              {(() => {
                const petStoreData = getPetStoreData();
                const selectedPet = petStoreData[selectedStorePet as keyof typeof petStoreData];
                
                return (
                  <div>
            {/* Header */}
            <div className="text-center mb-6">
                      <h2 className="text-3xl font-bold text-gray-800">
                        {selectedPet.name}
              </h2>
            </div>

                    {/* Pet Adoption Section (if not owned) */}
                    {!selectedPet.owned && (
                      <div className="mb-6">
                        {/* Large Pet Display for Unowned Pets */}
                        <div className="text-center mb-4 p-6 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border-2 border-purple-200">
                          <div className="text-8xl mb-4 animate-bounce">{selectedPet.emoji}</div>
                        </div>
                        
                        {/* Check if this is a placeholder */}
                        {(selectedPet as any).isPlaceholder ? (
                          <div className="p-4 bg-gradient-to-r from-gray-100 to-gray-200 rounded-xl border-2 border-gray-300">
                            <div className="text-center text-gray-600 font-semibold">
                              🕰️ Coming Soon! More amazing pets will be added in future updates!
                            </div>
                          </div>
                        ) : (
                          <div className="p-4 bg-gradient-to-r from-purple-100 to-pink-100 rounded-xl border-2 border-purple-300">
                            <button
                              onClick={() => {
                                handlePetPurchase(selectedPet.id, selectedPet.cost);
                                // Refresh the store data to reflect new ownership
                                setStoreRefreshTrigger(prev => prev + 1);
                              }}
                              disabled={!hasEnoughCoins(selectedPet.cost)}
                              className={`w-full p-4 rounded-xl font-bold text-xl transition-all duration-200 ${
                                hasEnoughCoins(selectedPet.cost)
                                  ? 'bg-gradient-to-r from-purple-500 to-pink-600 text-white hover:scale-105 shadow-lg'
                                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                              }`}
                            >
                              {hasEnoughCoins(selectedPet.cost) 
                                ? `Buy for ${selectedPet.cost} coins`
                                : `Need ${selectedPet.cost} coins`
                              }
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Den Section */}
                    {selectedPet.owned && (
                      <div className="mb-6">
                        <h3 className="text-xl font-bold text-gray-800 mb-4 text-center">
                          Den
                        </h3>
                        <div className="p-6 rounded-xl border-2 bg-gradient-to-br from-green-50 to-emerald-100 border-green-300">
                          <div className="text-center">
                            <div className="text-6xl mb-4">
                              {selectedPet.den.emoji}
                            </div>
                            <button
                              onClick={() => {
                                if (selectedPet.id === 'cat') {
                                  if (purchaseDen(selectedPet.id, selectedPet.den.cost)) {
                                    playEvolutionSound();
                                    alert(`You bought the den! It will arrive in 24 hours!`);
                                  } else {
                                    alert(`Not enough coins! You need ${selectedPet.den.cost} coins.`);
                                  }
                                } else {
                                  alert(`🎉 You bought the den! It will arrive in 24 hours!`);
                                }
                              }}
                              disabled={isDenOwned(selectedPet.id) || !hasEnoughCoins(selectedPet.den.cost)}
                              className={`px-6 py-3 rounded-xl font-bold text-xl transition-all duration-200 ${
                                isDenOwned(selectedPet.id)
                                  ? 'bg-green-500 text-white cursor-default'
                                  : hasEnoughCoins(selectedPet.den.cost)
                                  ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:scale-105 shadow-lg'
                                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                              }`}
                            >
                              {isDenOwned(selectedPet.id)
                                ? 'Owned'
                                : hasEnoughCoins(selectedPet.den.cost)
                                ? `Buy for ${selectedPet.den.cost} coins`
                                : `Need ${selectedPet.den.cost} coins`
                              }
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Accessories Section */}
                    {selectedPet.owned && (
                      <div>
                        <h3 className="text-xl font-bold text-gray-800 mb-4 text-center">
                          Accessories
                    </h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          {selectedPet.accessories.map((accessory) => {
                            const isOwned = isAccessoryOwned(selectedPet.id, accessory.id);
                            
                            return (
                              <div
                                key={accessory.id}
                                className={`p-4 rounded-xl border-2 ${
                                  isOwned 
                                    ? 'bg-gradient-to-br from-green-100 to-emerald-100 border-green-300'
                                    : 'bg-gradient-to-br from-gray-100 to-gray-200 border-gray-300'
                                }`}
                              >
                                <div className="text-center">
                                  <div className={`text-4xl mb-2 ${
                                    isOwned ? '' : 'grayscale'
                                  }`}>
                                    {accessory.emoji}
                                  </div>
                                  <div className="text-xs text-gray-600 mb-2 font-medium">
                                    {accessory.name}
                                  </div>
                                  <button
                                    onClick={() => {
                                      if (!isOwned && hasEnoughCoins(50)) {
                                        if (purchaseAccessory(selectedPet.id, accessory.id, 50)) {
                                          playEvolutionSound();
                                          alert(`You bought ${accessory.name}! It will arrive in 24 hours!`);
                                        }
                                      }
                                    }}
                                    disabled={isOwned || !hasEnoughCoins(50)}
                                    className={`px-3 py-2 rounded-lg text-lg font-bold transition-all duration-200 ${
                                      isOwned
                                        ? 'bg-green-500 text-white cursor-default'
                                        : hasEnoughCoins(50)
                                        ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:scale-105 shadow-lg'
                                        : 'bg-gray-400 text-gray-600 cursor-not-allowed'
                                    }`}
                                  >
                                    {isOwned
                                      ? 'Owned'
                                      : hasEnoughCoins(50)
                                      ? 'Buy for 50 coins'
                                      : 'Need 50 coins'
                                    }
                                  </button>
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      <style>
        {`
          @keyframes petGrow {
            0% {
              opacity: 0.7;
              transform: scale(0.95);
            }
            50% {
              opacity: 0.9;
              transform: scale(1.05);
            }
            100% {
              opacity: 1;
              transform: scale(1);
            }
          }
          
          @keyframes petEvolve {
            0% {
              opacity: 0.6;
              transform: scale(0.9) rotate(-2deg);
            }
            25% {
              opacity: 0.8;
              transform: scale(1.1) rotate(1deg);
            }
            50% {
              opacity: 0.9;
              transform: scale(0.98) rotate(-0.5deg);
            }
            75% {
              opacity: 0.95;
              transform: scale(1.02) rotate(0.5deg);
            }
            100% {
              opacity: 1;
              transform: scale(1) rotate(0deg);
            }
          }
          
          @keyframes heartbeat {
            0%, 100% {
              transform: scale(1);
            }
            50% {
              transform: scale(1.1);
            }
          }
          
          @keyframes heartFlyFromPet1 {
            0% {
              transform: translate(-50%, -50%) scale(1);
              opacity: 1;
            }
            50% {
              transform: translate(200px, -150px) scale(0.8);
              opacity: 0.8;
            }
            100% {
              transform: translate(350px, -280px) scale(0.3);
              opacity: 0;
            }
          }
          
          @keyframes heartFlyFromPet2 {
            0% {
              transform: translate(-50%, -50%) scale(1);
              opacity: 1;
            }
            50% {
              transform: translate(180px, -120px) scale(0.7);
              opacity: 0.9;
            }
            100% {
              transform: translate(330px, -300px) scale(0.2);
              opacity: 0;
            }
          }
          
          @keyframes heartFlyFromPet3 {
            0% {
              transform: translate(-50%, -50%) scale(1);
              opacity: 1;
            }
            50% {
              transform: translate(220px, -180px) scale(0.9);
              opacity: 0.7;
            }
            100% {
              transform: translate(370px, -260px) scale(0.4);
              opacity: 0;
            }
          }
          
          @keyframes thoughtBubble {
            0%, 100% {
              transform: scale(1);
              opacity: 0.7;
            }
            50% {
              transform: scale(1.2);
              opacity: 1;
            }
          }
        `}
      </style>
    </div>
  );
}
