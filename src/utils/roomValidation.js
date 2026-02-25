/**
 * Room Validation Utilities
 * 
 * Building has EXACTLY 12 rooms (construction completed 2018)
 * Floor 1: 101-106
 * Floor 2: 201-206
 * 
 * NO MORE ROOMS CAN BE ADDED
 */

// Valid room numbers - FIXED LIST, never change
export const VALID_ROOM_NUMBERS = [
  '101', '102', '103', '104', '105', '106',  // Floor 1
  '201', '202', '203', '204', '205', '206'   // Floor 2
];

// Maximum rooms allowed
export const MAX_ROOMS = 12;

/**
 * Check if room number is valid
 * @param {string} roomNumber - Room number to validate
 * @returns {boolean} True if valid, false otherwise
 */
export const isValidRoomNumber = (roomNumber) => {
  return VALID_ROOM_NUMBERS.includes(String(roomNumber));
};

/**
 * Get floor number from room number
 * @param {string} roomNumber - Room number
 * @returns {number} Floor number (1 or 2)
 */
export const getFloorFromRoom = (roomNumber) => {
  const roomNum = String(roomNumber);
  if (roomNum.startsWith('1')) return 1;
  if (roomNum.startsWith('2')) return 2;
  return 0; // Invalid
};

/**
 * Get all room numbers for a specific floor
 * @param {number} floor - Floor number (1 or 2)
 * @returns {string[]} Array of room numbers
 */
export const getRoomsByFloor = (floor) => {
  if (floor === 1) return ['101', '102', '103', '104', '105', '106'];
  if (floor === 2) return ['201', '202', '203', '204', '205', '206'];
  return [];
};

/**
 * Validate room count
 * @param {number} count - Current room count
 * @returns {object} Validation result
 */
export const validateRoomCount = (count) => {
  const isValid = count === MAX_ROOMS;
  const hasExtra = count > MAX_ROOMS;
  const hasMissing = count < MAX_ROOMS;
  
  return {
    isValid,
    hasExtra,
    hasMissing,
    count,
    expected: MAX_ROOMS,
    message: isValid 
      ? '✅ Correct number of rooms'
      : hasExtra 
        ? `❌ Too many rooms! Found ${count}, expected ${MAX_ROOMS}`
        : `⚠️ Missing rooms! Found ${count}, expected ${MAX_ROOMS}`
  };
};

/**
 * Filter only valid rooms from a list
 * @param {Array} rooms - Array of room objects
 * @returns {Array} Filtered array with only valid rooms
 */
export const filterValidRooms = (rooms) => {
  return rooms.filter(room => isValidRoomNumber(room.roomNumber));
};

/**
 * Find duplicate room numbers in a list
 * @param {Array} rooms - Array of room objects
 * @returns {Array} Array of room numbers that have duplicates
 */
export const findDuplicateRooms = (rooms) => {
  const roomCounts = {};
  const duplicates = [];
  
  rooms.forEach(room => {
    const roomNum = String(room.roomNumber);
    roomCounts[roomNum] = (roomCounts[roomNum] || 0) + 1;
  });
  
  Object.entries(roomCounts).forEach(([roomNum, count]) => {
    if (count > 1) {
      duplicates.push({ roomNumber: roomNum, count });
    }
  });
  
  return duplicates;
};

/**
 * Find invalid room numbers in a list
 * @param {Array} rooms - Array of room objects
 * @returns {Array} Array of invalid room objects
 */
export const findInvalidRooms = (rooms) => {
  return rooms.filter(room => !isValidRoomNumber(room.roomNumber));
};

/**
 * Security check - prevent room creation beyond limit
 * @param {number} currentCount - Current room count
 * @param {number} toAdd - Number of rooms to add
 * @returns {object} Check result
 */
export const canAddRooms = (currentCount, toAdd = 1) => {
  const newTotal = currentCount + toAdd;
  const allowed = newTotal <= MAX_ROOMS;
  
  return {
    allowed,
    currentCount,
    toAdd,
    newTotal,
    limit: MAX_ROOMS,
    message: allowed
      ? `✅ Can add ${toAdd} room(s)`
      : `❌ Cannot add ${toAdd} room(s). Would exceed limit of ${MAX_ROOMS}`
  };
};

export default {
  VALID_ROOM_NUMBERS,
  MAX_ROOMS,
  isValidRoomNumber,
  getFloorFromRoom,
  getRoomsByFloor,
  validateRoomCount,
  filterValidRooms,
  findDuplicateRooms,
  findInvalidRooms,
  canAddRooms
};
