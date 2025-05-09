// Utility functions for the game
export class Utils {
    // Generate a random number between min and max (inclusive)
    static randomRange(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    
    // Calculate distance between two points
    static distance(x1, y1, z1, x2, y2, z2) {
        return Math.sqrt(
            Math.pow(x2 - x1, 2) + 
            Math.pow(y2 - y1, 2) + 
            Math.pow(z2 - z1, 2)
        );
    }
    
    // Clamp a value between min and max
    static clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
    
    // Linear interpolation function (commonly abbreviated as 'lerp' in graphics programming)
    // Calculates a value between two points a and b based on parameter t (0-1)
    static lerp(a, b, t) {
        return a + (b - a) * t;
    }
    
    // Convert degrees to radians
    static degToRad(degrees) {
        return degrees * Math.PI / 180;
    }
    
    // Convert radians to degrees
    static radToDeg(radians) {
        return radians * 180 / Math.PI;
    }
}
